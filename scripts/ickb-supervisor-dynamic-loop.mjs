#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFile, lstat, mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseNonNegativeInteger, parsePositiveInteger, valueAfter } from "./ickb-script-helpers.mjs";
import {
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE as DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  INSPECTION_REQUIRED_EXIT_CODE,
} from "./ickb-supervisor-loop.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const CKB_UNIT = 100000000n;
const DEFAULT_TESTER_CONFIG = "config/tester-testnet.json";
const DEFAULT_PREFLIGHT_SCRIPT = "scripts/ickb-live-preflight.mjs";
const DEFAULT_SUPERVISOR_LOOP_SCRIPT = "scripts/ickb-supervisor-loop.mjs";
const DEFAULT_LOG_ROOT = "log";
const DEFAULT_CHUNK_MAX_RUNS = 8;
const DEFAULT_STABLE_LIMIT = 999;
const DEFAULT_CHUNK_BACKOFF_SECONDS = 20;
const DEFAULT_BETWEEN_CHUNKS_SECONDS = 20;
const DEFAULT_CHILD_TIMEOUT_SECONDS = DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS;
export const DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE = DEFAULT_CHILD_TIMEOUT_SECONDS;
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 240;
const DEFAULT_CHUNK_TIMEOUT_MARGIN_SECONDS = 60;
const DEFAULT_PREFLIGHT_TIMEOUT_SECONDS = 120;
const DYNAMIC_LOOP_OWNED_FLAGS = [
  "--tester-config",
  "--preflight-role",
  "--preflight-script",
  "--supervisor-loop-script",
  "--log-root",
  "--session-root",
  "--max-chunks",
  "--chunk-max-runs",
  "--stable-limit",
  "--chunk-backoff-seconds",
  "--between-chunks-seconds",
  "--child-timeout-seconds",
  "--chunk-timeout-seconds",
  "--preflight-timeout-seconds",
];
const ALL_CKB_MIN_CKB = 3001n;
const ICKB_STIMULUS_MIN_CKB = 2100n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export function parseArgs(argv) {
  const args = {
    help: false,
    testerConfig: DEFAULT_TESTER_CONFIG,
    preflightRole: "tester-dynamic-loop",
    preflightScript: DEFAULT_PREFLIGHT_SCRIPT,
    supervisorLoopScript: DEFAULT_SUPERVISOR_LOOP_SCRIPT,
    chunkMaxRuns: DEFAULT_CHUNK_MAX_RUNS,
    stableLimit: DEFAULT_STABLE_LIMIT,
    chunkBackoffSeconds: DEFAULT_CHUNK_BACKOFF_SECONDS,
    betweenChunksSeconds: DEFAULT_BETWEEN_CHUNKS_SECONDS,
    childTimeoutSeconds: DEFAULT_CHILD_TIMEOUT_SECONDS,
    commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
    preflightTimeoutSeconds: DEFAULT_PREFLIGHT_TIMEOUT_SECONDS,
    supervisorArgs: [],
  };
  let chunkTimeoutSecondsExplicit = false;
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
    if (arg === "--tester-config") {
      args.testerConfig = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--preflight-role") {
      args.preflightRole = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--preflight-script") {
      args.preflightScript = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--supervisor-loop-script") {
      args.supervisorLoopScript = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--log-root") {
      args.logRoot = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--session-root") {
      args.sessionRoot = valueAfter(argv, ++index, arg);
      continue;
    }
    if (arg === "--max-chunks") {
      args.maxChunks = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--chunk-max-runs") {
      args.chunkMaxRuns = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--stable-limit") {
      args.stableLimit = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--chunk-backoff-seconds") {
      args.chunkBackoffSeconds = parseNonNegativeInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--between-chunks-seconds") {
      args.betweenChunksSeconds = parseNonNegativeInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--child-timeout-seconds") {
      args.childTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--command-timeout-seconds") {
      args.commandTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    if (arg === "--chunk-timeout-seconds") {
      args.chunkTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      chunkTimeoutSecondsExplicit = true;
      continue;
    }
    if (arg === "--preflight-timeout-seconds") {
      args.preflightTimeoutSeconds = parsePositiveInteger(valueAfter(argv, ++index, arg), arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  const misplacedDynamicLoopFlag = firstMatchingFlag(args.supervisorArgs, DYNAMIC_LOOP_OWNED_FLAGS);
  if (misplacedDynamicLoopFlag !== undefined) {
    throw new Error(`Do not pass dynamic-loop option ${misplacedDynamicLoopFlag} after --; put dynamic-loop options before --`);
  }
  if (args.supervisorArgs.some((arg) => arg === "--out-dir" || arg.startsWith("--out-dir="))) {
    throw new Error("Do not pass supervisor --out-dir; dynamic-loop owns the session chunk roots");
  }
  const minimumChunkTimeoutSeconds = supervisorLoopChunkTimeoutFloorSeconds(args);
  if (chunkTimeoutSecondsExplicit) {
    if (BigInt(args.chunkTimeoutSeconds) < minimumChunkTimeoutSeconds) {
      throw new Error(`Invalid --chunk-timeout-seconds: expected at least ${minimumChunkTimeoutSeconds.toString()} seconds for this chunk shape`);
    }
  } else {
    if (minimumChunkTimeoutSeconds > MAX_SAFE_INTEGER) {
      throw new Error("Invalid derived --chunk-timeout-seconds: expected a safe integer; lower --chunk-max-runs, --child-timeout-seconds, or --chunk-backoff-seconds");
    }
    args.chunkTimeoutSeconds = Number(minimumChunkTimeoutSeconds);
  }
  return args;
}

export function usage() {
  return [
    "Usage: node scripts/ickb-supervisor-dynamic-loop.mjs [options]",
    "Options:",
    `  --tester-config <ignored-json-config>  Default: ${DEFAULT_TESTER_CONFIG}`,
    `  --preflight-role <label>              Default: tester-dynamic-loop`,
    `  --max-chunks <n>                      Default: unbounded`,
    `  --chunk-max-runs <n>                  Default: ${String(DEFAULT_CHUNK_MAX_RUNS)}`,
    `  --stable-limit <n>                    Default: ${String(DEFAULT_STABLE_LIMIT)}`,
    `  --chunk-backoff-seconds <n>           Default: ${String(DEFAULT_CHUNK_BACKOFF_SECONDS)}`,
    `  --between-chunks-seconds <n>          Default: ${String(DEFAULT_BETWEEN_CHUNKS_SECONDS)}`,
    `  --child-timeout-seconds <n>           Default: ${String(DEFAULT_CHILD_TIMEOUT_SECONDS)}`,
    `  --command-timeout-seconds <n>         Default: ${String(DEFAULT_COMMAND_TIMEOUT_SECONDS)}`,
    `  --chunk-timeout-seconds <n>           Default: derived from chunk-max-runs, child-timeout, and backoff`,
    `  --preflight-timeout-seconds <n>       Default: ${String(DEFAULT_PREFLIGHT_TIMEOUT_SECONDS)}`,
    `  --preflight-script <path>             Default: ${DEFAULT_PREFLIGHT_SCRIPT}`,
    `  --supervisor-loop-script <path>       Default: ${DEFAULT_SUPERVISOR_LOOP_SCRIPT}`,
    `  --log-root <path>                     Default: ${DEFAULT_LOG_ROOT}/`,
    "  --session-root <path>                 Default: <log-root>/validation/dynamic-<time>-<pid>",
    "  -h, --help",
    "  -- [supervisor-options]",
    "Dynamic-loop options must appear before --; supervisor --out-dir is owned by the dynamic loop.",
    "Reads tester preflight balance summaries, chooses a fundable tester scenario, then runs bounded supervisor-loop chunks.",
  ].join("\n");
}

function supervisorLoopChunkTimeoutFloorSeconds(args) {
  return BigInt(args.chunkMaxRuns) * BigInt(args.childTimeoutSeconds) +
    BigInt(Math.max(0, args.chunkMaxRuns - 1)) * BigInt(args.chunkBackoffSeconds) +
    BigInt(DEFAULT_CHUNK_TIMEOUT_MARGIN_SECONDS);
}

export function fixed8DecimalToUnits(value) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(value ?? "");
  if (match === null) {
    return undefined;
  }
  return BigInt(match[1]) * CKB_UNIT + BigInt((match[2] ?? "").padEnd(8, "0"));
}

export function chooseTesterScenario({ ckb, ickb }) {
  if (ckb >= ALL_CKB_MIN_CKB * CKB_UNIT) {
    return { scenario: "all-ckb-limit-order", feeArgs: [] };
  }
  if (ckb >= ICKB_STIMULUS_MIN_CKB * CKB_UNIT && ickb > 0n) {
    return {
      scenario: "ickb-to-ckb-limit-order",
      feeArgs: ["--tester-fee", "1", "--tester-fee-base", "1000"],
    };
  }
  return { scenario: "auto", feeArgs: [] };
}

export async function runDynamicSupervisorLoop({ argv, root = rootDir, dependencies = {}, io = {} }) {
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
    const result = runNode([
      isAbsolute(args.supervisorLoopScript) ? args.supervisorLoopScript : resolve(root, args.supervisorLoopScript),
      "--",
      ...args.supervisorArgs,
    ], root, dependencies, { timeout: args.chunkTimeoutSeconds * 1000 });
    if (result.stdout) {
      stdout.write(result.stdout);
    }
    if (result.stderr) {
      stderr.write(result.stderr);
    }
    return typeof result.status === "number" ? result.status : 1;
  }

  let session;
  try {
    session = await prepareValidationSession(args, root, dependencies);
    await writeLaunchArtifact(session, args, root, dependencies);
    await writeOperatorEvent(session, {
      type: "session_started",
      sessionRoot: session.displaySessionRoot,
      logRoot: session.displayLogRoot,
    }, dependencies);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }

  for (let chunkIndex = 1; args.maxChunks === undefined || chunkIndex <= args.maxChunks; chunkIndex += 1) {
    const preflight = runTesterPreflight(args, root, dependencies);
    if (!preflight.ok) {
      const record = {
        type: "preflight_failed",
        chunkIndex,
        status: preflight.status,
        signal: preflight.signal,
        reason: preflight.reason,
      };
      writeJsonLine(stdout, record);
      await writeOperatorEvent(session, record, dependencies);
      if (preflight.stderr) {
        stderr.write(preflight.stderr);
        await appendOperatorStderr(session, preflight.stderr, dependencies);
      }
      return typeof preflight.status === "number" ? preflight.status : 1;
    }

    const choice = chooseTesterScenario(preflight);
    const selectedRecord = {
      type: "selected",
      chunkIndex,
      testerCkbAvailable: preflight.ckbText,
      testerIckbAvailable: preflight.ickbText,
      testerScenario: choice.scenario,
    };
    writeJsonLine(stdout, selectedRecord);
    await writeOperatorEvent(session, selectedRecord, dependencies);

    const result = runSupervisorChunk(args, choice, root, dependencies, session, chunkIndex);
    if (result.stdout) {
      stdout.write(result.stdout);
    }
    if (result.stderr) {
      stderr.write(result.stderr);
      await appendOperatorStderr(session, result.stderr, dependencies);
    }
    const chunkError = spawnErrorMessage(result);
    if (chunkError !== undefined) {
      const message = `Supervisor chunk failed: ${chunkError}\n`;
      stderr.write(message);
      await appendOperatorStderr(session, message, dependencies);
    }
    const stopReason = supervisorLoopStopReason(result.stdout ?? "");
    const finishedRecord = {
      type: "chunk_finished",
      chunkIndex,
      outRoot: chunkOutRootDisplay(session, root, chunkIndex),
      status: result.status,
      signal: result.signal,
      ...(stopReason === undefined ? {} : { supervisorLoopStopReason: stopReason }),
    };
    writeJsonLine(stdout, finishedRecord);
    await writeOperatorEvent(session, finishedRecord, dependencies);
    if (result.status !== 0) {
      return typeof result.status === "number" ? result.status : 1;
    }
    if (stopReason === "tx_observed" || stopReason === "new_outcome") {
      return 0;
    }
    if (stopReason === "max_runs" || stopReason === "stable_no_progress") {
      return INSPECTION_REQUIRED_EXIT_CODE;
    }

    if ((args.maxChunks === undefined || chunkIndex < args.maxChunks) && args.betweenChunksSeconds > 0) {
      await sleepMs(args.betweenChunksSeconds * 1000, dependencies);
    }
  }

  return 0;
}

function supervisorLoopStopReason(stdout) {
  const reasons = [...stdout.matchAll(/^loop stopped reason=([^\s]+)/gmu)].map((match) => match[1]);
  return reasons.at(-1) ?? [...stdout.matchAll(/^loop run=\d+ .*\bdecision=([^\s]+)/gmu)].map((match) => match[1]).at(-1);
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

function hasHelpFlag(args) {
  return args.some((arg) => arg === "-h" || arg === "--help");
}

function runTesterPreflight(args, root, dependencies) {
  const result = runNode([
    args.preflightScript,
    "--config",
    args.testerConfig,
    "--role",
    args.preflightRole,
  ], root, dependencies, { timeout: args.preflightTimeoutSeconds * 1000 });
  if (result.error !== undefined || result.status !== 0) {
    const spawnError = spawnErrorMessage(result);
    return {
      ok: false,
      status: result.status,
      signal: result.signal,
      stderr: result.stderr,
      reason: spawnError === undefined ? "preflight command failed" : `preflight command failed: ${spawnError}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, status: 1, signal: null, stderr: result.stderr, reason: "preflight returned invalid JSON" };
  }
  const ckbText = parsed?.balances?.CKB?.available;
  const ickbText = parsed?.balances?.ICKB?.available;
  const ckb = fixed8DecimalToUnits(ckbText);
  const ickb = fixed8DecimalToUnits(ickbText);
  if (ckb === undefined || ickb === undefined) {
    return { ok: false, status: 1, signal: null, stderr: result.stderr, reason: "preflight balances missing or invalid" };
  }
  return { ok: true, ckb, ickb, ckbText, ickbText };
}

function runSupervisorChunk(args, choice, root, dependencies, session, chunkIndex) {
  const chunkOutRoot = join(session.chunksDir, `chunk-${padChunk(chunkIndex)}`);
  const testerScenarioArgs = choice.scenario === "auto" ? [] : ["--tester-scenario", choice.scenario];
  return runNode([
    args.supervisorLoopScript,
    "--out-root", displayPath(root, chunkOutRoot),
    "--max-runs", String(args.chunkMaxRuns),
    "--stable-limit", String(args.stableLimit),
    "--backoff-seconds", String(args.chunkBackoffSeconds),
    "--child-timeout-seconds", String(args.childTimeoutSeconds),
    "--",
    ...testerScenarioArgs,
    "--max-cycles", "1",
    "--command-timeout-seconds", String(args.commandTimeoutSeconds),
    ...args.supervisorArgs,
    ...choice.feeArgs,
  ], root, dependencies, { timeout: args.chunkTimeoutSeconds * 1000 });
}

async function prepareValidationSession(args, root, dependencies) {
  const now = dependencies.now ?? Date.now;
  const pid = dependencies.pid ?? process.pid;
  const logRoot = resolveConfiguredPath(root, args.logRoot ?? DEFAULT_LOG_ROOT, "--log-root");
  const sessionRoot = resolveConfiguredPath(
    root,
    args.sessionRoot ?? join(logRoot, "validation", `dynamic-${String(Math.floor(now() / 1000))}-${String(pid)}`),
    "--session-root",
  );
  assertContained(logRoot, sessionRoot, "--session-root");
  assertValidationSessionShape(logRoot, sessionRoot);
  await assertNoSymlinkedPath(logRoot, "log root", dependencies);
  await assertNoSymlinkedPath(sessionRoot, "session root", dependencies);

  const relativeSessionRoot = relative(root, sessionRoot);
  if (!relativeSessionRoot.startsWith("..") && !isAbsolute(relativeSessionRoot) && !checkIgnored(root, relativeSessionRoot, dependencies)) {
    throw new Error(`Refusing to write non-ignored validation session root: ${relativeSessionRoot}`);
  }

  const statFn = dependencies.stat ?? stat;
  try {
    await statFn(sessionRoot);
    throw new Error(`Validation session root already exists: ${displayPath(root, sessionRoot)}`);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const mkdirFn = dependencies.mkdir ?? mkdir;
  const operatorDir = join(sessionRoot, "operator");
  const chunksDir = join(sessionRoot, "chunks");
  await mkdirFn(operatorDir, { recursive: true });
  await mkdirFn(chunksDir, { recursive: true });
  return {
    logRoot,
    sessionRoot,
    operatorDir,
    chunksDir,
    displayLogRoot: displayPath(root, logRoot),
    displaySessionRoot: displayPath(root, sessionRoot),
  };
}

async function writeLaunchArtifact(session, args, root, dependencies) {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const startedAt = new Date((dependencies.now ?? Date.now)()).toISOString();
  await writeFileFn(join(session.operatorDir, "launch.json"), `${JSON.stringify({
    version: 1,
    app: "dynamic-supervisor-loop",
    startedAt,
    pid: dependencies.pid ?? process.pid,
    root,
    logRoot: session.displayLogRoot,
    sessionRoot: session.displaySessionRoot,
    options: {
      testerConfig: args.testerConfig,
      preflightRole: args.preflightRole,
      preflightScript: args.preflightScript,
      supervisorLoopScript: args.supervisorLoopScript,
      maxChunks: args.maxChunks ?? null,
      chunkMaxRuns: args.chunkMaxRuns,
      stableLimit: args.stableLimit,
      chunkBackoffSeconds: args.chunkBackoffSeconds,
      betweenChunksSeconds: args.betweenChunksSeconds,
      childTimeoutSeconds: args.childTimeoutSeconds,
      commandTimeoutSeconds: args.commandTimeoutSeconds,
      chunkTimeoutSeconds: args.chunkTimeoutSeconds,
      preflightTimeoutSeconds: args.preflightTimeoutSeconds,
      supervisorArgCount: args.supervisorArgs.length,
    },
  }, jsonReplacer, 2)}\n`);
}

async function writeOperatorEvent(session, record, dependencies) {
  const appendFileFn = dependencies.appendFile ?? appendFile;
  await appendFileFn(join(session.operatorDir, "events.ndjson"), `${JSON.stringify({
    at: new Date((dependencies.now ?? Date.now)()).toISOString(),
    ...record,
  }, jsonReplacer)}\n`);
}

async function appendOperatorStderr(session, text, dependencies) {
  const appendFileFn = dependencies.appendFile ?? appendFile;
  await appendFileFn(join(session.operatorDir, "stderr.log"), text);
}

function runNode(commandArgs, root, dependencies, options) {
  const spawnSyncFn = dependencies.spawnSync ?? spawnSync;
  return spawnSyncFn(process.execPath, commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: minimalProcessEnv(process.env),
    maxBuffer: 1024 * 1024,
    ...options,
  });
}

function spawnErrorMessage(result) {
  return result.error === undefined ? undefined : errorMessage(result.error);
}

async function sleepMs(ms, dependencies) {
  if (dependencies.sleep !== undefined) {
    await dependencies.sleep(ms);
    return;
  }
  await sleep(ms);
}

function writeJsonLine(stream, record) {
  stream.write(`${JSON.stringify({ at: new Date().toISOString(), ...record }, jsonReplacer)}\n`);
}

function jsonReplacer(_key, value) {
  return typeof value === "bigint" ? value.toString() : value;
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

function resolveConfiguredPath(root, value, flag) {
  if (value === "") {
    throw new Error(`${flag} must not be empty`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function assertContained(root, candidate, label) {
  const relationship = relative(root, candidate);
  if (relationship === "" || relationship === ".." || relationship.startsWith(`..${sep}`) || isAbsolute(relationship)) {
    throw new Error(`${label} must stay under --log-root`);
  }
}

function assertValidationSessionShape(logRoot, sessionRoot) {
  const parts = relative(logRoot, sessionRoot).split(sep).filter((part) => part !== "");
  if (parts.length === 2 && parts[0] === "validation") {
    return;
  }
  throw new Error("--session-root must be <log-root>/validation/<session>");
}

async function assertNoSymlinkedPath(path, label, dependencies) {
  const lstatFn = dependencies.lstat ?? lstat;
  const parsed = parse(path);
  let current = parsed.root;
  const parts = relative(parsed.root, path).split(sep).filter((part) => part !== "");
  for (const part of parts) {
    current = join(current, part);
    try {
      const stats = await lstatFn(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to use ${label} through symlinked path: ${current}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

function checkIgnored(root, relativePath, dependencies) {
  if (dependencies.checkIgnored !== undefined) {
    return dependencies.checkIgnored(relativePath);
  }
  const result = spawnSync("git", ["-C", root, "check-ignore", "--", relativePath], { encoding: "utf8" });
  return result.status === 0;
}

function displayPath(root, path) {
  const relativePath = relative(root, path);
  return relativePath.startsWith("..") || isAbsolute(relativePath) ? path : relativePath;
}

function chunkOutRootDisplay(session, root, chunkIndex) {
  return displayPath(root, join(session.chunksDir, `chunk-${padChunk(chunkIndex)}`));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

function isNotFoundError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function padChunk(index) {
  return String(index).padStart(4, "0");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await runDynamicSupervisorLoop({ argv: process.argv.slice(2) });
}
