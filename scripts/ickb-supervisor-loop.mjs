#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseNonNegativeInteger, parsePositiveInteger, valueAfter } from "./ickb-script-helpers.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MAX_RUNS = 10;
const DEFAULT_STABLE_LIMIT = 3;
const DEFAULT_BACKOFF_SECONDS = 30;
const DEFAULT_CHILD_TIMEOUT_SECONDS = 65 * 60;
export const DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE = DEFAULT_CHILD_TIMEOUT_SECONDS;
const DEFAULT_SUPERVISOR_SCRIPT = "apps/supervisor/dist/index.js";
const SUPERVISOR_OUTPUT_ROOT = "logs/live-supervisor";
export const INSPECTION_REQUIRED_EXIT_CODE = 3;
const LOOP_OWNED_FLAGS = ["--out-root", "--max-runs", "--stable-limit", "--backoff-seconds", "--child-timeout-seconds", "--supervisor-script"];
export function parseArgs(argv) {
  const args = {
    help: false,
    maxRuns: DEFAULT_MAX_RUNS,
    stableLimit: DEFAULT_STABLE_LIMIT,
    backoffSeconds: DEFAULT_BACKOFF_SECONDS,
    childTimeoutSeconds: DEFAULT_CHILD_TIMEOUT_SECONDS,
    supervisorScript: DEFAULT_SUPERVISOR_SCRIPT,
    supervisorArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      args.supervisorArgs = argv.slice(index + 1);
      break;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--out-root") {
      args.outRoot = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--max-runs") {
      args.maxRuns = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--stable-limit") {
      args.stableLimit = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--backoff-seconds") {
      args.backoffSeconds = parseNonNegativeInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--child-timeout-seconds") {
      args.childTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--supervisor-script") {
      args.supervisorScript = valueAfter(argv, ++index, arg);
      continue;
    }
    throw new Error(`Unknown argument before --: ${arg}`);
  }
  const misplacedLoopFlag = firstMatchingFlag(args.supervisorArgs, LOOP_OWNED_FLAGS);
  if (misplacedLoopFlag !== undefined) {
    throw new Error(`Do not pass loop option ${misplacedLoopFlag} after --; put loop options before --`);
  }
  if (args.supervisorArgs.some((arg) => arg === "--out-dir" || arg.startsWith("--out-dir="))) {
    throw new Error("Do not pass supervisor --out-dir; use loop --out-root instead");
  }
  return args;
}

export function usage() {
  return [
    "Usage: node scripts/ickb-supervisor-loop.mjs [loop-options] -- [supervisor-options]",
    "Loop options:",
    `  --out-root <dir>               Default: ${SUPERVISOR_OUTPUT_ROOT}/loop-<time>-<pid>`,
    `  --max-runs <n>                 Default: ${String(DEFAULT_MAX_RUNS)}`,
    `  --stable-limit <n>             Default: ${String(DEFAULT_STABLE_LIMIT)}`,
    `  --backoff-seconds <n>          Default: ${String(DEFAULT_BACKOFF_SECONDS)}`,
    `  --child-timeout-seconds <n>    Default: ${String(DEFAULT_CHILD_TIMEOUT_SECONDS)}`,
    `  --supervisor-script <path>     Default: ${DEFAULT_SUPERVISOR_SCRIPT}`,
    "  -h, --help",
    "Reads only each child run summary.json.",
    "Loop options must appear before --; supervisor --out-dir is owned by the loop.",
  ].join("\n");
}

export function summarizeRun(summary, { runIndex, relativeOutDir, status }) {
  const aggregateCounts = countRecord(summary.aggregateCounts);
  const txCount = requiredCount(summary.txCreatingTxHashCount, "txCreatingTxHashCount");
  const txCreatingOutcomeCount = requiredCount(summary.txCreatingOutcomeCount, "txCreatingOutcomeCount");
  const hasTxCreatingOutcome = txCreatingOutcomeCount > 0;
  const artifacts = stringArray(summary.artifacts);
  return {
    runIndex,
    relativeOutDir,
    status,
    stopped: typeof summary.stopped === "string" ? summary.stopped : "unknown",
    aggregateCounts,
    outcomes: Object.keys(aggregateCounts).filter((key) => aggregateCounts[key] > 0).sort(),
    txCount,
    hasTxCreatingOutcome,
    hasIncident: artifacts.some((artifact) => artifact.endsWith("incident.json")),
    skipReasons: stringArray(summary.skipReasons),
    publicState: isRecord(summary.publicVsOwnedStateAssumptions) ? summary.publicVsOwnedStateAssumptions : null,
    signature: summarySignature(summary),
  };
}

export function decideNext({ run, priorOutcomes, previousSignature, stableCount, stableLimit, runIndex, maxRuns }) {
  const newOutcomes = run.outcomes.filter((outcome) => !priorOutcomes.has(outcome));
  const nextStableCount = previousSignature === run.signature ? stableCount + 1 : 1;
  if (run.hasIncident) {
    return { action: "stop", reason: "incident", newOutcomes, stableCount: nextStableCount, exitCode: 2 };
  }
  if (run.status !== 0) {
    return { action: "stop", reason: "supervisor_nonzero", newOutcomes, stableCount: nextStableCount, exitCode: run.status };
  }
  if (run.txCount > 0 || run.hasTxCreatingOutcome) {
    return { action: "stop", reason: "tx_observed", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  if (runIndex > 1 && newOutcomes.length > 0) {
    return { action: "stop", reason: "new_outcome", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  if (runIndex >= maxRuns) {
    return { action: "stop", reason: "max_runs", newOutcomes, stableCount: nextStableCount, exitCode: INSPECTION_REQUIRED_EXIT_CODE };
  }
  if (nextStableCount >= stableLimit) {
    return { action: "stop", reason: "stable_no_progress", newOutcomes, stableCount: nextStableCount, exitCode: INSPECTION_REQUIRED_EXIT_CODE };
  }
  return { action: "continue", reason: "continue", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
}

export function summarySignature(summary) {
  return JSON.stringify({
    stopped: typeof summary.stopped === "string" ? summary.stopped : "unknown",
    aggregateCounts: sortedEntries(countRecord(summary.aggregateCounts)),
    skipReasons: stringArray(summary.skipReasons).sort(),
    testerOrderEvidence: normalizeJson(summary.testerOrderEvidence ?? null),
    preflightState: normalizeJson(summary.preflightState ?? null),
    scenarioAttempts: normalizeJson(summary.scenarioAttempts ?? null),
    coverage: normalizeJson(summary.coverage ?? null),
    publicVsOwnedStateAssumptions: normalizeJson(summary.publicVsOwnedStateAssumptions ?? null),
  });
}

export async function runSupervisorLoop({ argv, root = rootDir, dependencies = {}, io = {} }) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (hasHelpFlag(args.supervisorArgs)) {
    const supervisorScript = isAbsolute(args.supervisorScript)
      ? args.supervisorScript
      : resolve(root, args.supervisorScript);
    const spawnResult = spawnSupervisorHelp({
      root,
      supervisorScript,
      supervisorArgs: args.supervisorArgs,
      stdout,
      stderr,
      dependencies,
    });
    return typeof spawnResult.status === "number" ? spawnResult.status : 1;
  }

  const now = dependencies.now ?? Date.now;
  let outRoot;
  let supervisorScript;
  try {
    outRoot = resolveLoopOutRoot(root, args.outRoot ?? defaultOutRoot(now(), dependencies.pid ?? process.pid));
    supervisorScript = isAbsolute(args.supervisorScript)
      ? args.supervisorScript
      : resolve(root, args.supervisorScript);
    await assertNoSymlinkedLoopOutputAncestors(root, outRoot.absolutePath, dependencies);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  const priorOutcomes = new Set();
  let previousSignature;
  let stableCount = 0;

  for (let runIndex = 1; runIndex <= args.maxRuns; runIndex += 1) {
    const runOutDir = join(outRoot.absolutePath, `run-${padRun(runIndex)}`);
    const relativeOutDir = displayPath(root, runOutDir);
    const spawnResult = spawnSupervisor({
      root,
      supervisorScript,
      supervisorArgs: args.supervisorArgs,
      relativeOutDir,
      childTimeoutSeconds: args.childTimeoutSeconds,
      dependencies,
    });
    const status = typeof spawnResult.status === "number" ? spawnResult.status : 1;
    let run;
    try {
      const summary = await readSummary(join(runOutDir, "summary.json"), dependencies);
      run = summarizeRun(summary, { runIndex, relativeOutDir, status });
    } catch (error) {
      stdout.write(formatMissingSummaryLine({ runIndex, relativeOutDir, status, error }) + "\n");
      return status === 0 ? 1 : status;
    }

    const decision = decideNext({
      run,
      priorOutcomes,
      previousSignature,
      stableCount,
      stableLimit: args.stableLimit,
      runIndex,
      maxRuns: args.maxRuns,
    });
    stdout.write(formatRunLine(run, decision) + "\n");

    for (const outcome of run.outcomes) {
      priorOutcomes.add(outcome);
    }
    previousSignature = run.signature;
    stableCount = decision.stableCount;

    if (decision.action === "stop") {
      stdout.write(`loop stopped reason=${decision.reason} runs=${String(runIndex)} out=${outRoot.relativePath}\n`);
      return decision.exitCode;
    }
    if (args.backoffSeconds > 0) {
      await sleep(args.backoffSeconds * 1000, dependencies);
    }
  }

  return 0;
}

function spawnSupervisor({ root, supervisorScript, supervisorArgs, relativeOutDir, childTimeoutSeconds, dependencies }) {
  const spawnSyncFn = dependencies.spawnSync ?? spawnSync;
  return spawnSyncFn(process.execPath, [
    supervisorScript,
    ...supervisorArgs,
    "--out-dir",
    relativeOutDir,
  ], {
    cwd: root,
    env: minimalProcessEnv(process.env),
    stdio: "ignore",
    timeout: childTimeoutSeconds * 1000,
    killSignal: "SIGTERM",
  });
}

function spawnSupervisorHelp({ root, supervisorScript, supervisorArgs, stdout, stderr, dependencies }) {
  const spawnSyncFn = dependencies.spawnSync ?? spawnSync;
  return spawnSyncFn(process.execPath, [
    supervisorScript,
    ...supervisorArgs,
  ], {
    cwd: root,
    env: minimalProcessEnv(process.env),
    stdio: ["ignore", stdout, stderr],
  });
}

function hasHelpFlag(args) {
  return args.some((arg) => arg === "-h" || arg === "--help");
}

function firstMatchingFlag(args, flags) {
  for (const arg of args) {
    for (const flag of flags) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        return flag;
      }
    }
  }
  return undefined;
}

async function readSummary(path, dependencies) {
  const readFileFn = dependencies.readFile ?? readFile;
  const text = await readFileFn(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("summary.json invalid JSON", { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error("summary.json is not a JSON object");
  }
  return parsed;
}

async function sleep(ms, dependencies) {
  if (dependencies.sleep !== undefined) {
    await dependencies.sleep(ms);
    return;
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function formatRunLine(run, decision) {
  return [
    `loop run=${String(run.runIndex)}`,
    `status=${String(run.status)}`,
    `stopped=${run.stopped}`,
    `outcomes=${formatCounts(run.aggregateCounts)}`,
    `tx=${String(run.txCount)}`,
    `new=${decision.newOutcomes.length === 0 ? "-" : decision.newOutcomes.join(",")}`,
    `stable=${String(decision.stableCount)}`,
    `state=${formatPublicState(run.publicState)}`,
    `decision=${decision.reason}`,
    `out=${run.relativeOutDir}`,
  ].join(" ");
}

function formatMissingSummaryLine({ runIndex, relativeOutDir, status, error }) {
  return [
    `loop run=${String(runIndex)}`,
    `status=${String(status)}`,
    "summary=missing_or_invalid",
    `error=${shellWord(errorMessage(error))}`,
    `out=${relativeOutDir}`,
  ].join(" ");
}

function formatCounts(counts) {
  const entries = sortedEntries(counts);
  return entries.length === 0
    ? "-"
    : entries.map(([key, value]) => `${key}:${String(value)}`).join(",");
}

function formatPublicState(state) {
  if (!isRecord(state)) {
    return "-";
  }
  const keys = ["marketOrderCount", "userOrderCount", "receiptCount"];
  const fields = keys
    .filter((key) => typeof state[key] === "number")
    .map((key) => `${key}:${String(state[key])}`);
  return fields.length === 0 ? "-" : fields.join(",");
}

function minimalProcessEnv(env) {
  return {
    ...Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TERM"].flatMap((key) => {
      const value = env[key];
      return value === undefined ? [] : [[key, value]];
    })),
    NODE_OPTIONS: "--disable-warning=DEP0040",
  };
}

function resolveLoopOutRoot(root, outRoot) {
  if (outRoot === "") {
    throw new Error("--out-root must not be empty");
  }
  const absolutePath = isAbsolute(outRoot) ? outRoot : resolve(root, outRoot);
  const relativePath = displayPath(root, absolutePath);
  if (!isAllowedLoopOutRoot(absolutePath, relativePath)) {
    throw new Error(`--out-root must be under ${SUPERVISOR_OUTPUT_ROOT} or a validation session chunks directory`);
  }
  return { absolutePath, relativePath };
}

function isAllowedLoopOutRoot(absolutePath, relativePath) {
  return relativePath === SUPERVISOR_OUTPUT_ROOT ||
    relativePath.startsWith(`${SUPERVISOR_OUTPUT_ROOT}/`) ||
    isValidationChunkRoot(absolutePath);
}

function isValidationChunkRoot(path) {
  const parts = path.split(/[\\/]+/u);
  for (let index = 0; index < parts.length - 3; index += 1) {
    if (parts[index] === "validation" && parts[index + 2] === "chunks" && /^chunk-[0-9]{4}$/u.test(parts[index + 3] ?? "") && index + 4 === parts.length) {
      return true;
    }
  }
  return false;
}

function defaultOutRoot(nowMs, pid) {
  return `${SUPERVISOR_OUTPUT_ROOT}/loop-${String(Math.floor(nowMs / 1000))}-${String(pid)}`;
}

function countRecord(value) {
  if (!isRecord(value)) {
    return {};
  }
  const counts = {};
  for (const [key, item] of Object.entries(value)) {
    if (Number.isSafeInteger(item) && item > 0) {
      counts[key] = item;
    }
  }
  return counts;
}

function sortedEntries(record) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

async function assertNoSymlinkedLoopOutputAncestors(root, absolutePath, dependencies) {
  const lstatFn = dependencies.lstat ?? lstat;
  const base = isInside(root, absolutePath) ? root : parse(absolutePath).root;
  const parts = relative(base, absolutePath).split(sep).filter((part) => part !== "");
  let current = base;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stats = await lstatFn(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to use loop output root through symlinked path: ${displayPath(root, current)}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isInside(root, path) {
  const relationship = relative(root, path);
  return relationship === "" || (!relationship.startsWith("..") && !isAbsolute(relationship));
}

function displayPath(root, path) {
  return isInside(root, path) ? relative(root, path) : path;
}

function requiredCount(value, key) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`summary.json ${key} missing or invalid`);
  }
  return value;
}

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeJson(item)]),
  );
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shellWord(value) {
  return String(value).replace(/\s+/gu, "_");
}

function padRun(index) {
  return String(index).padStart(4, "0");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runSupervisorLoop({ argv: process.argv.slice(2) });
}
