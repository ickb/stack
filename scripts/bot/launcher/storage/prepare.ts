import path from "node:path";

import { parseOptionalPositiveSafeInteger } from "../args.ts";
import { closeSinks, openLogSinks, selectRunLogs } from "../logs.ts";
import { resolveLauncherPaths } from "../paths.ts";
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
import { applyStorageQuota } from "./retention.ts";

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

  const storageQuotaBytes =
    parsed.logStorageQuotaBytes ??
    parseOptionalPositiveSafeInteger(
      context.env["ICKB_BOT_LOG_STORAGE_QUOTA_BYTES"],
      "ICKB_BOT_LOG_STORAGE_QUOTA_BYTES",
    );
  await prepareLogDirectory(path.join(paths.logDir, "artifacts"));
  const runLogs = await selectRunLogs(paths.logDir);
  await resetArtifactDirectory(runLogs.logFiles.artifacts);
  const sinks = await openLogSinks(runLogs);
  try {
    if (storageQuotaBytes !== undefined) {
      await applyStorageQuota(paths.logDir, runLogs.slot.name, storageQuotaBytes);
    }

    const packageInfo = await readBotPackageInfo(context.root);
    return {
      packageInfo,
      paths,
      root: context.root,
      runLogs,
      sinks,
      storageQuotaBytes,
    };
  } catch (error) {
    await ignoreError(closeSinks(sinks));
    throw error;
  }
}
