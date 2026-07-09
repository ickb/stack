import { botSourceCommand } from "./constants.ts";
import { forwardSignalsTo, safeCommandShape, waitForChild } from "./process.ts";
import type {
  LauncherContext,
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
  const child = context.spawnProcess(command, commandArgs, {
    cwd: context.root,
    env: {
      ...context.env,
      BOT_ARTIFACT_REF_PREFIX: config.runLogs.artifactRefPrefix,
      BOT_ARTIFACT_ROOT: config.runLogs.logFiles.artifacts,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  return {
    child,
    childCommand: safeCommandShape(command, commandArgs.length),
    childResultPromise: waitForChild(child),
    packageInfo: config.packageInfo,
    paths: config.paths,
    removeSignalHandlers: forwardSignalsTo(child),
    root: config.root,
    runLogs: config.runLogs,
    storageQuotaBytes: config.storageQuotaBytes,
  };
}
