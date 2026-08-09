import path from "node:path";

import { closeSinks, openLogSinks, selectRunLogs } from "../logs.ts";
import { resolveLauncherPaths } from "../paths.ts";
import { acquireLauncherLock, releaseLauncherLock } from "../runtime/process.ts";
import { ignoreError } from "../runtime/support.ts";
import type {
  LauncherContext,
  ParsedLauncherArgs,
  PreparedLaunchConfig,
} from "../runtime/types.ts";
import {
  prepareLogDirectory,
  prepareLogPaths,
  resetArtifactDirectory,
} from "./filesystem.ts";
import { readBotPackageInfo } from "./metadata.ts";

export async function prepareLaunchConfig(
  parsed: Exclude<ParsedLauncherArgs, { help: true }>,
  context: LauncherContext,
): Promise<PreparedLaunchConfig> {
  const paths = resolveLauncherPaths({
    cliLogRoot: parsed.logRoot,
    envLogRoot: context.env["ICKB_BOT_LOG_ROOT"],
    logDir: parsed.logDir,
    root: context.root,
  });
  await prepareLogPaths(paths);
  const lock = await acquireLauncherLock(paths.logDir);

  try {
    await prepareLogDirectory(path.join(paths.logDir, "artifacts"));
    const runLogs = await selectRunLogs(paths.logDir);
    await resetArtifactDirectory(runLogs.logFiles.artifacts);
    const sinks = await openLogSinks(runLogs);
    try {
      const packageInfo = await readBotPackageInfo(context.root);
      return {
        lock,
        packageInfo,
        paths,
        root: context.root,
        runLogs,
        sinks,
      };
    } catch (error) {
      await ignoreError(closeSinks(sinks));
      throw error;
    }
  } catch (error) {
    await ignoreError(releaseLauncherLock(lock));
    throw error;
  }
}
