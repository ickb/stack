import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatPrebuildFailure,
  INSPECTION_REQUIRED_EXIT_CODE,
  prebuildRuntime,
} from "../loop.ts";
import { hasHelpFlag, parseArgs, usage } from "./args.ts";
import {
  errorMessage,
  runNode,
  sleepMs,
  spawnErrorMessage,
  writeJsonLine,
} from "./command.ts";
import {
  MAX_CYCLES_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_SCENARIO_FLAG,
  type ChunkStep,
  type ContinueAfterChunkInput,
  type DynamicArgs,
  type DynamicLoopDependencies,
  type DynamicLoopRuntime,
  type PreflightFailureInput,
  type RunDynamicSupervisorLoopInput,
  type SupervisorChunkInput,
  type TesterChoice,
  type TesterPreflightFailure,
  type TesterPreflightSuccess,
  type TextCommandResult,
  type TextWriter,
} from "./model.ts";
import { runTesterPreflight, testerFeePolicyFromSupervisorArgs } from "./preflight.ts";
import { chooseTesterScenario } from "./scenario.ts";
import {
  appendSupervisorStderr,
  chunkOutRootDisplay,
  createValidationSession,
  displayPath,
  resolveTesterConfig,
  resolveValidationSession,
  writeLaunchArtifact,
  writeSupervisorEvent,
} from "./session.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));
const { isAbsolute, join, resolve } = path;

export async function runDynamicSupervisorLoop({
  argv,
  root = rootDir,
  dependencies = {},
  io = {},
}: RunDynamicSupervisorLoopInput): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = parseDynamicArgsForRun(argv, stderr);
  if (args === undefined) {
    return 1;
  }
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  if (hasHelpFlag(args.supervisorArgs)) {
    return runSupervisorHelp(args, root, dependencies, { stderr, stdout });
  }

  const runtime = await prepareDynamicLoopRuntime({
    args,
    dependencies,
    root,
    stderr,
    stdout,
  });
  if (runtime === undefined) {
    return 1;
  }

  const prebuild = await prebuildRuntime(root, runtime.dependencies);
  if (prebuild.status !== 0) {
    stdout.write(`${formatPrebuildFailure(prebuild)}\n`);
    return prebuild.status;
  }

  if (!(await startDynamicLoopSession(runtime))) {
    return 1;
  }

  return runDynamicChunks(runtime);
}

async function runDynamicChunks(runtime: DynamicLoopRuntime): Promise<number> {
  let consecutiveStatusOneStops = 0;
  for (
    let chunkIndex = 1;
    runtime.args.maxChunks === undefined || chunkIndex <= runtime.args.maxChunks;
    chunkIndex += 1
  ) {
    const preflight = await runTesterPreflight(
      runtime.args,
      runtime.root,
      runtime.dependencies,
    );
    if (!preflight.ok) {
      const step = await handlePreflightFailure({
        ...runtime,
        chunkIndex,
        consecutiveStatusOneStops,
        preflight,
      });
      if (step.kind === "continue") {
        consecutiveStatusOneStops = step.consecutiveStatusOneStops;
        continue;
      }
      return step.exitCode;
    }
    consecutiveStatusOneStops = 0;

    const choice = chooseTesterScenario({
      ...preflight,
      rawOrderFeePolicy: testerFeePolicyFromSupervisorArgs(runtime.args.supervisorArgs),
    });
    await writeSelectionEvent(runtime, preflight, choice, chunkIndex);

    const step = await runSupervisorChunkStep({ ...runtime, choice, chunkIndex });
    if (step.kind === "return") {
      return step.exitCode;
    }
  }

  return 0;
}

function parseDynamicArgsForRun(
  argv: readonly string[],
  stderr: TextWriter,
): DynamicArgs | undefined {
  try {
    return parseArgs(argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return undefined;
  }
}

async function runSupervisorHelp(
  args: DynamicArgs,
  root: string,
  dependencies: DynamicLoopDependencies,
  writers: { stderr: TextWriter; stdout: TextWriter },
): Promise<number> {
  const result = await runNode(
    [
      isAbsolute(args.supervisorLoopScript)
        ? args.supervisorLoopScript
        : resolve(root, args.supervisorLoopScript),
      "--",
      ...args.supervisorArgs,
    ],
    root,
    dependencies,
    { timeout: args.chunkTimeoutSeconds * 1000 },
  );
  if (result.stdout.length > 0) {
    writers.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    writers.stderr.write(result.stderr);
  }
  return typeof result.status === "number" ? result.status : 1;
}

async function prepareDynamicLoopRuntime(
  input: Omit<DynamicLoopRuntime, "session">,
): Promise<DynamicLoopRuntime | undefined> {
  try {
    const args = {
      ...input.args,
      testerConfig: await resolveTesterConfig(
        input.args.testerConfig,
        input.root,
        input.dependencies,
      ),
    };
    return {
      ...input,
      args,
      session: await resolveValidationSession(args, input.root, input.dependencies),
    };
  } catch (error) {
    input.stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return undefined;
  }
}

async function startDynamicLoopSession(runtime: DynamicLoopRuntime): Promise<boolean> {
  try {
    await createValidationSession(runtime.session, runtime.dependencies);
    await writeLaunchArtifact(
      runtime.session,
      runtime.args,
      runtime.root,
      runtime.dependencies,
    );
    await writeSupervisorEvent(
      runtime.session,
      {
        type: "session_started",
        sessionRoot: runtime.session.displaySessionRoot,
        logRoot: runtime.session.displayLogRoot,
      },
      runtime.dependencies,
    );
    return true;
  } catch (error) {
    runtime.stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return false;
  }
}

function expectedSupervisorLoopStopExitCode(
  stopReason: string | undefined,
): number | undefined {
  if (stopReason === "tx_observed" || stopReason === "new_outcome") {
    return 0;
  }
  if (stopReason === "max_runs" || stopReason === "stable_no_progress") {
    return INSPECTION_REQUIRED_EXIT_CODE;
  }
  return undefined;
}

async function handlePreflightFailure({
  args,
  dependencies,
  session,
  stdout,
  stderr,
  chunkIndex,
  consecutiveStatusOneStops,
  preflight,
}: PreflightFailureInput): Promise<ChunkStep> {
  const exitCode = typeof preflight.status === "number" ? preflight.status : 1;
  const record = {
    type: "preflight_failed",
    chunkIndex,
    status: preflight.status,
    signal: preflight.signal,
    reason: preflight.reason,
  };
  writeJsonLine(stdout, record);
  await writeSupervisorEvent(session, record, dependencies);
  if (preflight.stderr.length > 0) {
    stderr.write(preflight.stderr);
    await appendSupervisorStderr(session, preflight.stderr, dependencies);
  }
  if (!shouldRetryPreflight(args, preflight, chunkIndex)) {
    return { kind: "return", exitCode };
  }
  const nextStatusOneStops = consecutiveStatusOneStops + 1;
  if (nextStatusOneStops <= 1) {
    await continueAfterChunk({
      args,
      dependencies,
      session,
      stdout,
      chunkIndex,
      reason: "status_1_retry",
      status: exitCode,
    });
    return { kind: "continue", consecutiveStatusOneStops: nextStatusOneStops };
  }
  const repeatedRecord = {
    type: "repeated_status_1",
    chunkIndex,
    status: exitCode,
    reason: preflight.reason,
  };
  writeJsonLine(stdout, repeatedRecord);
  await writeSupervisorEvent(session, repeatedRecord, dependencies);
  return { kind: "return", exitCode };
}

function shouldRetryPreflight(
  args: DynamicArgs,
  preflight: TesterPreflightFailure,
  chunkIndex: number,
): boolean {
  return args.keepGoing && preflight.retryableStatusOne && hasNextChunk(args, chunkIndex);
}

async function writeSelectionEvent(
  runtime: DynamicLoopRuntime,
  preflight: TesterPreflightSuccess,
  choice: TesterChoice,
  chunkIndex: number,
): Promise<void> {
  const record = {
    type: "selected",
    chunkIndex,
    testerCkbAvailable: preflight.ckbText,
    ...(preflight.plainCkbText === undefined
      ? {}
      : { testerPlainCkbAvailable: preflight.plainCkbText }),
    ...(preflight.projectedCkbText === undefined
      ? {}
      : { testerProjectedCkbAvailable: preflight.projectedCkbText }),
    testerIckbAvailable: preflight.ickbText,
    ...(preflight.ickbUnavailableText === undefined
      ? {}
      : { testerIckbUnavailable: preflight.ickbUnavailableText }),
    ...(preflight.ickbTotalText === undefined
      ? {}
      : { testerIckbTotal: preflight.ickbTotalText }),
    testerScenario: choice.scenario,
  };
  writeJsonLine(runtime.stdout, record);
  await writeSupervisorEvent(runtime.session, record, runtime.dependencies);
}

async function runSupervisorChunkStep(input: SupervisorChunkInput): Promise<ChunkStep> {
  const result = await runSupervisorChunk(input);
  await writeChunkOutput(input, result);
  const stopReason = supervisorLoopStopReason(result.stdout);
  const finishedRecord = {
    type: "chunk_finished",
    chunkIndex: input.chunkIndex,
    outRoot: chunkOutRootDisplay(input.session, input.root, input.chunkIndex),
    status: result.status,
    signal: result.signal,
    ...(stopReason === undefined ? {} : { supervisorLoopStopReason: stopReason }),
  };
  writeJsonLine(input.stdout, finishedRecord);
  await writeSupervisorEvent(input.session, finishedRecord, input.dependencies);
  return supervisorChunkDecision(input, result, stopReason);
}

async function writeChunkOutput(
  input: SupervisorChunkInput,
  result: TextCommandResult,
): Promise<void> {
  if (result.stdout.length > 0) {
    input.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    input.stderr.write(result.stderr);
    await appendSupervisorStderr(input.session, result.stderr, input.dependencies);
  }
  const chunkError = spawnErrorMessage(result);
  if (chunkError !== undefined) {
    const message = `Supervisor chunk failed: ${chunkError}\n`;
    input.stderr.write(message);
    await appendSupervisorStderr(input.session, message, input.dependencies);
  }
}

async function supervisorChunkDecision(
  input: SupervisorChunkInput,
  result: TextCommandResult,
  stopReason: string | undefined,
): Promise<ChunkStep> {
  const expectedStopExitCode = expectedSupervisorLoopStopExitCode(stopReason);
  if (isUnexpectedSupervisorStatus(input.args, result, expectedStopExitCode)) {
    return {
      kind: "return",
      exitCode: typeof result.status === "number" ? result.status : 1,
    };
  }
  if (expectedStopExitCode === undefined) {
    await sleepBetweenChunks(input.args, input.dependencies, input.chunkIndex);
    return { kind: "continue", consecutiveStatusOneStops: 0 };
  }
  if (!input.args.keepGoing) {
    return { kind: "return", exitCode: expectedStopExitCode };
  }
  if (!hasNextChunk(input.args, input.chunkIndex)) {
    return { kind: "return", exitCode: 0 };
  }
  await continueAfterChunk({
    args: input.args,
    dependencies: input.dependencies,
    session: input.session,
    stdout: input.stdout,
    chunkIndex: input.chunkIndex,
    reason: stopReason,
    status: result.status,
  });
  return { kind: "continue", consecutiveStatusOneStops: 0 };
}

function isUnexpectedSupervisorStatus(
  args: DynamicArgs,
  result: TextCommandResult,
  expectedStopExitCode: number | undefined,
): boolean {
  return (
    result.status !== 0 &&
    !(
      args.keepGoing &&
      result.status === INSPECTION_REQUIRED_EXIT_CODE &&
      expectedStopExitCode === INSPECTION_REQUIRED_EXIT_CODE
    )
  );
}

function hasNextChunk(args: DynamicArgs, chunkIndex: number): boolean {
  return args.maxChunks === undefined || chunkIndex < args.maxChunks;
}

async function continueAfterChunk({
  args,
  dependencies,
  session,
  stdout,
  chunkIndex,
  reason,
  status,
}: ContinueAfterChunkInput): Promise<void> {
  const record = {
    type: "continuing_after_chunk",
    chunkIndex,
    reason,
    status,
  };
  writeJsonLine(stdout, record);
  await writeSupervisorEvent(session, record, dependencies);
  await sleepBetweenChunks(args, dependencies, chunkIndex);
}

async function sleepBetweenChunks(
  args: DynamicArgs,
  dependencies: DynamicLoopDependencies,
  chunkIndex: number,
): Promise<void> {
  if (hasNextChunk(args, chunkIndex) && args.betweenChunksSeconds > 0) {
    await sleepMs(args.betweenChunksSeconds * 1000, dependencies);
  }
}

function supervisorLoopStopReason(stdout: string): string | undefined {
  const reasons = [...stdout.matchAll(/^loop stopped reason=(\S+)/gmu)].map(
    (match) => match[1],
  );
  return (
    reasons.at(-1) ??
    [...stdout.matchAll(/^loop run=\d+ .*\bdecision=(\S+)/gmu)]
      .map((match) => match[1])
      .at(-1)
  );
}

async function runSupervisorChunk({
  args,
  choice,
  dependencies,
  root,
  session,
  chunkIndex,
}: SupervisorChunkInput): Promise<TextCommandResult> {
  const chunkOutRoot = join(session.chunksDir, `chunk-${padChunk(chunkIndex)}`);
  const testerScenarioArgs =
    choice.scenario === "auto" ? [] : [TESTER_SCENARIO_FLAG, choice.scenario];
  return runNode(
    [
      args.supervisorLoopScript,
      "--out-root",
      displayPath(root, chunkOutRoot),
      "--max-runs",
      String(args.chunkMaxRuns),
      "--stable-limit",
      String(args.stableLimit),
      "--backoff-seconds",
      String(args.chunkBackoffSeconds),
      "--child-timeout-seconds",
      String(args.childTimeoutSeconds),
      "--",
      TESTER_CONFIG_FLAG,
      args.testerConfig,
      ...testerScenarioArgs,
      MAX_CYCLES_FLAG,
      "1",
      "--command-timeout-seconds",
      String(args.commandTimeoutSeconds),
      ...choice.feeArgs,
      ...args.supervisorArgs,
    ],
    root,
    dependencies,
    { timeout: args.chunkTimeoutSeconds * 1000 },
  );
}

function padChunk(index: number): string {
  return String(index).padStart(4, "0");
}
