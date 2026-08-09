import { launcherStartedType } from "./constants.ts";
import type {
  ExitLaunchRecordInput,
  LaunchRecordInput,
  LaunchRecordShape,
  LogSinkLike,
  ParsedLauncherArgs,
  PreparedLaunch,
} from "./types.ts";

export function startLaunchRecord(
  parsed: Exclude<ParsedLauncherArgs, { help: true }>,
  launch: PreparedLaunch,
  now: () => Date,
): LaunchRecordShape {
  return launchRecord({
    child: launch.child,
    childCommand: launch.childCommand,
    elapsedMs: 0,
    identity: requiredIdentity(launch),
    now,
    packageInfo: launch.packageInfo,
    parsed,
    paths: launch.paths,
    root: launch.root,
    runId: launch.runId,
    runLogs: launch.runLogs,
    signal: null,
    status: null,
    type: launcherStartedType,
  });
}

export function exitLaunchRecord({
  childResult,
  copyResult,
  elapsedMs,
  launch,
  now,
  parsed,
}: ExitLaunchRecordInput): LaunchRecordShape {
  return launchRecord({
    child: launch.child,
    childCommand: launch.childCommand,
    elapsedMs,
    identity: requiredIdentity(launch),
    now,
    packageInfo: launch.packageInfo,
    parsed,
    paths: launch.paths,
    root: launch.root,
    runId: launch.runId,
    runLogs: launch.runLogs,
    signal: childResult.signal,
    status: childResult.status,
    type: copyResult === undefined ? "launcher.child.exited" : "launcher.io.failed",
  });
}

export async function writeLaunchRecord(
  sink: LogSinkLike,
  record: unknown,
): Promise<void> {
  await sink.writeLine(record);
}

function launchRecord({
  child,
  childCommand,
  elapsedMs,
  identity,
  packageInfo,
  parsed,
  paths,
  root,
  runId,
  runLogs,
  now,
  signal,
  status,
  type,
}: LaunchRecordInput): LaunchRecordShape {
  return {
    app: "bot-launcher",
    childPid: child.pid ?? null,
    command: childCommand,
    elapsedMs,
    identity,
    logDir: paths.logDir,
    logFiles: runLogs.logFiles,
    logRoot: paths.logRoot,
    logSlot: runLogs.slot,
    nodeVersion: process.version,
    package: packageInfo,
    pid: process.pid,
    repoRoot: root,
    runId,
    signal,
    status,
    teeChildOutput: parsed.teeChildOutput,
    timestamp: now().toISOString(),
    type,
    version: 3,
  };
}

function requiredIdentity(launch: PreparedLaunch): LaunchRecordShape["identity"] {
  if (launch.identity === undefined) {
    throw new Error("Bot launcher process identity was not captured");
  }
  return launch.identity;
}
