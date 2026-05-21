#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TX_CREATING_OUTCOMES } from "../apps/supervisor/dist/index.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MAX_RUNS = 10;
const DEFAULT_STABLE_LIMIT = 3;
const DEFAULT_BACKOFF_SECONDS = 30;
const DEFAULT_SUPERVISOR_SCRIPT = "apps/supervisor/dist/index.js";
const SUPERVISOR_OUTPUT_ROOT = "logs/live-supervisor";
export function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === "--" && (argv[1] === "-h" || argv[1] === "--help")) {
    return {
      help: true,
      maxRuns: DEFAULT_MAX_RUNS,
      stableLimit: DEFAULT_STABLE_LIMIT,
      backoffSeconds: DEFAULT_BACKOFF_SECONDS,
      supervisorScript: DEFAULT_SUPERVISOR_SCRIPT,
      supervisorArgs: [],
    };
  }
  const args = {
    help: false,
    maxRuns: DEFAULT_MAX_RUNS,
    stableLimit: DEFAULT_STABLE_LIMIT,
    backoffSeconds: DEFAULT_BACKOFF_SECONDS,
    supervisorScript: DEFAULT_SUPERVISOR_SCRIPT,
    supervisorArgs: [],
  };
  let parsedLoopOption = false;
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
      parsedLoopOption = true;
      continue;
    }
    if (arg === "--max-runs") {
      args.maxRuns = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      parsedLoopOption = true;
      continue;
    }
    if (arg === "--stable-limit") {
      args.stableLimit = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      parsedLoopOption = true;
      continue;
    }
    if (arg === "--backoff-seconds") {
      args.backoffSeconds = parseNonNegativeInteger(valueAfter(argv, ++index, arg), arg);
      parsedLoopOption = true;
      continue;
    }
    if (arg === "--supervisor-script") {
      args.supervisorScript = valueAfter(argv, ++index, arg);
      parsedLoopOption = true;
      continue;
    }
    if (!parsedLoopOption) {
      args.supervisorArgs = argv.slice(index);
      break;
    }
    throw new Error(`Unknown argument before --: ${arg}`);
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
    `  --out-root <ignored-dir>       Default: ${SUPERVISOR_OUTPUT_ROOT}/loop-<time>-<pid>`,
    `  --max-runs <n>                 Default: ${String(DEFAULT_MAX_RUNS)}`,
    `  --stable-limit <n>             Default: ${String(DEFAULT_STABLE_LIMIT)}`,
    `  --backoff-seconds <n>          Default: ${String(DEFAULT_BACKOFF_SECONDS)}`,
    `  --supervisor-script <path>     Default: ${DEFAULT_SUPERVISOR_SCRIPT}`,
    "  -h, --help",
    "Reads only each child run summary.json.",
    "Supervisor --out-dir is owned by the loop and must not be passed after --.",
  ].join("\n");
}

export function summarizeRun(summary, { runIndex, relativeOutDir, status }) {
  const aggregateCounts = countRecord(summary.aggregateCounts);
  const txHashesByOutcome = arrayRecord(summary.txHashesByOutcome);
  const txCount = txCreatingCount(txHashesByOutcome);
  const artifacts = stringArray(summary.artifacts);
  return {
    runIndex,
    relativeOutDir,
    status,
    stopped: typeof summary.stopped === "string" ? summary.stopped : "unknown",
    aggregateCounts,
    outcomes: Object.keys(aggregateCounts).filter((key) => aggregateCounts[key] > 0).sort(),
    txCount,
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
  if (run.txCount > 0) {
    return { action: "stop", reason: "tx_observed", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  if (runIndex > 1 && newOutcomes.length > 0) {
    return { action: "stop", reason: "new_outcome", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  if (nextStableCount >= stableLimit) {
    return { action: "stop", reason: "stable_no_progress", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  if (runIndex >= maxRuns) {
    return { action: "stop", reason: "max_runs", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
  }
  return { action: "continue", reason: "continue", newOutcomes, stableCount: nextStableCount, exitCode: 0 };
}

export function summarySignature(summary) {
  return JSON.stringify({
    stopped: typeof summary.stopped === "string" ? summary.stopped : "unknown",
    aggregateCounts: sortedEntries(countRecord(summary.aggregateCounts)),
    skipReasons: stringArray(summary.skipReasons).sort(),
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

  const now = dependencies.now ?? Date.now;
  let outRoot;
  let supervisorScript;
  try {
    outRoot = resolveLoopOutRoot(root, args.outRoot ?? defaultOutRoot(now(), dependencies.pid ?? process.pid));
    supervisorScript = isAbsolute(args.supervisorScript)
      ? args.supervisorScript
      : resolve(root, args.supervisorScript);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  const priorOutcomes = new Set();
  let previousSignature;
  let stableCount = 0;

  for (let runIndex = 1; runIndex <= args.maxRuns; runIndex += 1) {
    const runOutDir = join(outRoot.absolutePath, `run-${padRun(runIndex)}`);
    const relativeOutDir = relative(root, runOutDir);
    const spawnResult = spawnSupervisor({
      root,
      supervisorScript,
      supervisorArgs: args.supervisorArgs,
      relativeOutDir,
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

function spawnSupervisor({ root, supervisorScript, supervisorArgs, relativeOutDir, dependencies }) {
  const spawnSyncFn = dependencies.spawnSync ?? spawnSync;
  return spawnSyncFn(process.execPath, [
    supervisorScript,
    ...supervisorArgs,
    "--out-dir",
    relativeOutDir,
  ], {
    cwd: root,
    stdio: "ignore",
  });
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

function resolveLoopOutRoot(root, outRoot) {
  if (outRoot === "") {
    throw new Error("--out-root must not be empty");
  }
  const absolutePath = isAbsolute(outRoot) ? outRoot : resolve(root, outRoot);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("--out-root must stay inside the repo");
  }
  if (relativePath !== SUPERVISOR_OUTPUT_ROOT && !relativePath.startsWith(`${SUPERVISOR_OUTPUT_ROOT}/`)) {
    throw new Error(`--out-root must be under ${SUPERVISOR_OUTPUT_ROOT}`);
  }
  return { absolutePath, relativePath };
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

function arrayRecord(value) {
  if (!isRecord(value)) {
    return {};
  }
  const arrays = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      arrays[key] = item.filter((entry) => typeof entry === "string");
    }
  }
  return arrays;
}

function txCreatingCount(txHashesByOutcome) {
  return Object.entries(txHashesByOutcome).reduce(
    (sum, [outcome, hashes]) => sum + (TX_CREATING_OUTCOMES.has(outcome) ? hashes.length : 0),
    0,
  );
}

function sortedEntries(record) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
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

function shellWord(value) {
  return String(value).replace(/\s+/gu, "_");
}

function valueAfter(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseNonNegativeInteger(value, flag) {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a non-negative integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
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
