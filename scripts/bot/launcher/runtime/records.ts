import { launcherStartedType } from "./constants.ts";
import type {
  ExitLaunchRecordInput,
  LaunchRecordInput,
  LaunchRecordShape,
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
    now,
    packageInfo: launch.packageInfo,
    parsed,
    paths: launch.paths,
    root: launch.root,
    runLogs: launch.runLogs,
    signal: null,
    status: null,
    storageQuotaBytes: launch.storageQuotaBytes,
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
    now,
    packageInfo: launch.packageInfo,
    parsed,
    paths: launch.paths,
    root: launch.root,
    runLogs: launch.runLogs,
    signal: childResult.signal,
    status: childResult.status,
    storageQuotaBytes: launch.storageQuotaBytes,
    type: copyResult === undefined ? "launcher.child.exited" : "launcher.io.failed",
  });
}

function launchRecord({
  child,
  childCommand,
  elapsedMs,
  packageInfo,
  parsed,
  paths,
  root,
  runLogs,
  storageQuotaBytes,
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
    logDir: paths.logDir,
    logFiles: runLogs.logFiles,
    logRoot: paths.logRoot,
    logRetention: {
      storageQuotaBytes: storageQuotaBytes ?? null,
    },
    logSlot: runLogs.slot,
    nodeVersion: process.version,
    package: packageInfo,
    pid: process.pid,
    repoRoot: root,
    signal,
    status,
    teeChildOutput: parsed.teeChildOutput,
    timestamp: now().toISOString(),
    type,
    version: 1,
  };
}
