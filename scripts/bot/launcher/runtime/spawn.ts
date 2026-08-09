import { botSourceCommand } from "./constants.ts";
import {
  forwardSignalsTo,
  safeCommandShape,
  waitForChild,
  waitForChildClose,
} from "./process.ts";
import type {
  ChildLike,
  LauncherContext,
  LauncherIdentity,
  ParsedLauncherArgs,
  PreparedLaunch,
  PreparedLaunchConfig,
} from "./types.ts";

export function spawnLaunch(
  parsed: Exclude<ParsedLauncherArgs, { help: true }>,
  context: LauncherContext,
  config: PreparedLaunchConfig,
): PreparedLaunch {
  const command = parsed.command ?? process.execPath;
  const commandArgs =
    parsed.command === undefined ? [botSourceCommand] : parsed.commandArgs;
  const runId = `${context.now().toISOString()}-${process.pid.toString(36)}`;
  const child = context.spawnProcess(command, commandArgs, {
    cwd: context.root,
    env: {
      ...context.env,
      BOT_ARTIFACT_REF_PREFIX: config.runLogs.artifactRefPrefix,
      BOT_ARTIFACT_ROOT: config.runLogs.logFiles.artifacts,
      BOT_RUN_ID: runId,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  return {
    child,
    childClosePromise: waitForChildClose(child),
    childCommand: safeCommandShape(command, commandArgs.length),
    childResultPromise: waitForChild(child),
    packageInfo: config.packageInfo,
    paths: config.paths,
    removeSignalHandlers: forwardSignalsTo(child),
    root: config.root,
    runId,
    runLogs: config.runLogs,
  };
}

export async function captureLaunchIdentity(
  child: ChildLike,
  context: LauncherContext,
): Promise<LauncherIdentity> {
  const childPid = child.pid;
  if (childPid === undefined) {
    throw new Error("Spawned bot child process lacks a PID");
  }
  const [launcher, childIdentity] = await Promise.all([
    context.readProcessIdentity(process.pid),
    context.readProcessIdentity(childPid),
  ]);
  if (launcher.bootId !== childIdentity.bootId) {
    throw new Error("Launcher and bot child process boot identities differ");
  }
  return {
    bootId: launcher.bootId,
    launcher: { pid: process.pid, startTimeTicks: launcher.startTimeTicks },
    child: { pid: childPid, startTimeTicks: childIdentity.startTimeTicks },
  };
}
