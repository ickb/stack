import { constants } from "node:fs";

export const appendLogFileFlags =
  constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW;
export const botSourceCommand = "apps/bot/src/index.ts";
export const defaultLogRoot = "log";
export const launchLogFileName = "launches.ndjson";
export const launcherLockNamePrefix = "ickb-bot-launcher-";
export const launcherStartedType = "launcher.started";
export const logDirectoryLabel = "log directory";
export const runLogSlotCount = 16;
export const signalNames: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
export const terminationGraceMs = 5_000;
