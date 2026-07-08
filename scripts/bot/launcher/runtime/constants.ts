import { constants } from "node:fs";

export const appendLogFileFlags =
  constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW;
export const truncateLogFileFlags =
  constants.O_TRUNC | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW;
export const botSourceCommand = "apps/bot/src/index.ts";
export const defaultLogRoot = "log";
export const launchLogFileName = "launches.ndjson";
export const launcherStartedType = "launcher.started";
export const logDirectoryLabel = "log directory";
export const runLogSlotCount = 16;
export const signalNames: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
