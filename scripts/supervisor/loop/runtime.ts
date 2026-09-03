import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, isRecord } from "../../../packages/node-utils/src/index.ts";
import { parseArgs, usage } from "./args.ts";
import {
  minimalProcessEnv,
  prebuildRuntime,
  runBoundedCommand,
  spawnSyncCommand,
} from "./command.ts";
import {
  TIMEOUT_KILL_GRACE_MS,
  type BoundedCommandResult,
  type CommandOutput,
  type LoopArgs,
  type RunSummaryInput,
  type RunSupervisorLoopInput,
  type SpawnSupervisorHelpInput,
  type SpawnSupervisorInput,
  type SummaryRecord,
  type SupervisorDecision,
  type SupervisorLoopDependencies,
  type SupervisorLoopIterationResult,
  type SupervisorLoopRunState,
  type SupervisorLoopRuntime,
  type SupervisorLoopWriters,
  type SupervisorRun,
  type TextWriter,
} from "./model.ts";
import {
  childSpawnError,
  formatMissingSummaryLine,
  formatPrebuildFailure,
  formatRunLine,
} from "./output.ts";
import {
  defaultOutRoot,
  displayPath,
  reserveLoopOutRoot,
  resolveLoopOutRoot,
} from "./paths.ts";
import { decideNext, summarizeRun } from "./summary.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const { isAbsolute, join, resolve: resolvePath } = path;

export async function runSupervisorLoop({
  argv,
  root = rootDir,
  dependencies = {},
  io = {},
}: RunSupervisorLoopInput): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let args: LoopArgs;
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
    return runSupervisorHelp(args, root, dependencies, { stderr, stdout });
  }

  let runtime: SupervisorLoopRuntime;
  try {
    runtime = await prepareSupervisorLoopRuntime(args, root, dependencies, stdout);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }

  const prebuildExit = await prebuildExitCode(root, dependencies, stdout);
  if (prebuildExit !== undefined) {
    return prebuildExit;
  }

  const runState: SupervisorLoopRunState = {
    priorOutcomes: new Set<string>(),
    stableCount: 0,
  };
  for (let runIndex = 1; runIndex <= args.maxRuns; runIndex += 1) {
    const result = await runSupervisorLoopIteration(runtime, runState, runIndex);
    if (result.kind === "return") {
      return result.exitCode;
    }
    if (result.decision.action === "stop") {
      stdout.write(
        `loop stopped reason=${result.decision.reason} runs=${String(runIndex)} out=${runtime.outRoot.relativePath}\n`,
      );
      return result.decision.exitCode;
    }
    if (args.backoffSeconds > 0) {
      await sleep(args.backoffSeconds * 1000, dependencies);
    }
  }

  return 0;
}

function runSupervisorHelp(
  args: LoopArgs,
  root: string,
  dependencies: SupervisorLoopDependencies,
  writers: SupervisorLoopWriters,
): number {
  const supervisorScript = resolveSupervisorScript(root, args.supervisorScript);
  const spawnResult = spawnSupervisorHelp({
    root,
    supervisorScript,
    supervisorArgs: args.supervisorArgs,
    dependencies,
  });
  writeCommandOutput(writers.stdout, spawnResult.stdout);
  writeCommandOutput(writers.stderr, spawnResult.stderr);
  return typeof spawnResult.status === "number" ? spawnResult.status : 1;
}

/** Runs the prebuild and returns its exit code when it fails. */
async function prebuildExitCode(
  root: string,
  dependencies: SupervisorLoopDependencies,
  stdout: TextWriter,
): Promise<number | undefined> {
  const prebuild = await prebuildRuntime(root, dependencies);
  if (prebuild.status === 0) {
    return undefined;
  }
  stdout.write(`${formatPrebuildFailure(prebuild)}\n`);
  return prebuild.status ?? 1;
}

async function prepareSupervisorLoopRuntime(
  args: LoopArgs,
  root: string,
  dependencies: SupervisorLoopDependencies,
  stdout: TextWriter,
): Promise<SupervisorLoopRuntime> {
  const now = dependencies.now ?? Date.now;
  const outRoot = resolveLoopOutRoot(
    root,
    args.outRoot ?? defaultOutRoot(now(), dependencies.pid ?? process.pid),
  );
  await reserveLoopOutRoot(root, outRoot.absolutePath);
  return {
    args,
    dependencies,
    outRoot,
    root,
    stdout,
    supervisorScript: resolveSupervisorScript(root, args.supervisorScript),
  };
}

async function runSupervisorLoopIteration(
  runtime: SupervisorLoopRuntime,
  state: SupervisorLoopRunState,
  runIndex: number,
): Promise<SupervisorLoopIterationResult> {
  const { args, dependencies, outRoot, root, stdout, supervisorScript } = runtime;
  const runOutDir = join(outRoot.absolutePath, `run-${padRun(runIndex)}`);
  const relativeOutDir = displayPath(root, runOutDir);
  const spawnResult = await spawnSupervisor({
    root,
    supervisorScript,
    supervisorArgs: args.supervisorArgs,
    relativeOutDir,
    childTimeoutSeconds: args.childTimeoutSeconds,
    dependencies,
  });
  const status = typeof spawnResult.status === "number" ? spawnResult.status : 1;
  let run: SupervisorRun;
  try {
    run = await summarizeSupervisorRun(
      { runIndex, relativeOutDir, status },
      runOutDir,
      spawnResult,
    );
  } catch (error) {
    stdout.write(
      `${formatMissingSummaryLine({ runIndex, relativeOutDir, status, error, spawnResult })}\n`,
    );
    return { kind: "return", exitCode: status === 0 ? 1 : status };
  }

  const decision = decideNext({
    run,
    priorOutcomes: state.priorOutcomes,
    previousSignature: state.previousSignature,
    stableCount: state.stableCount,
    stableLimit: args.stableLimit,
    runIndex,
    maxRuns: args.maxRuns,
  });
  stdout.write(`${formatRunLine(run, decision)}\n`);
  updateRunState(state, run, decision);
  return { kind: "continue", decision, run };
}

async function summarizeSupervisorRun(
  input: RunSummaryInput,
  runOutDir: string,
  spawnResult: BoundedCommandResult,
): Promise<SupervisorRun> {
  const summary = await readSummary(join(runOutDir, "summary.json"));
  return {
    ...summarizeRun(summary, input),
    childError:
      spawnResult.error === undefined ? undefined : childSpawnError(spawnResult.error),
    childSignal: signalText(spawnResult.signal),
  };
}

function updateRunState(
  state: SupervisorLoopRunState,
  run: SupervisorRun,
  decision: SupervisorDecision,
): void {
  const runState = state;
  for (const outcome of run.outcomes) {
    runState.priorOutcomes.add(outcome);
  }
  runState.previousSignature = run.signature;
  runState.stableCount = decision.stableCount;
}

function resolveSupervisorScript(root: string, supervisorScript: string): string {
  return isAbsolute(supervisorScript)
    ? supervisorScript
    : resolvePath(root, supervisorScript);
}

function writeCommandOutput(writer: TextWriter, output: CommandOutput | undefined): void {
  if (output !== undefined && output.length > 0) {
    writer.write(output);
  }
}

function signalText(signal: NodeJS.Signals | null | undefined): string | undefined {
  return typeof signal === "string" && signal.length > 0 ? signal : undefined;
}

async function spawnSupervisor({
  root,
  supervisorScript,
  supervisorArgs,
  relativeOutDir,
  childTimeoutSeconds,
  dependencies,
}: SpawnSupervisorInput): Promise<BoundedCommandResult> {
  return runBoundedCommand(
    process.execPath,
    [supervisorScript, ...supervisorArgs, "--out-dir", relativeOutDir],
    {
      cwd: root,
      env: minimalProcessEnv(process.env),
      stdio: "ignore",
      timeout: childTimeoutSeconds * 1000,
      killSignal: "SIGTERM",
      killAfterTimeout: TIMEOUT_KILL_GRACE_MS,
      detached: true,
    },
    dependencies,
  );
}

function spawnSupervisorHelp({
  root,
  supervisorScript,
  supervisorArgs,
  dependencies,
}: SpawnSupervisorHelpInput): BoundedCommandResult {
  return spawnSyncCommand(
    dependencies,
    process.execPath,
    [supervisorScript, ...supervisorArgs],
    {
      cwd: root,
      encoding: "utf8",
      env: minimalProcessEnv(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function hasHelpFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-h" || arg === "--help");
}

async function readSummary(summaryPath: string): Promise<SummaryRecord> {
  const text = await readFile(summaryPath, "utf8");
  let parsed: unknown;
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

async function sleep(
  ms: number,
  dependencies: SupervisorLoopDependencies,
): Promise<void> {
  if (dependencies.sleep !== undefined) {
    await dependencies.sleep(ms);
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function padRun(index: number): string {
  return String(index).padStart(4, "0");
}
