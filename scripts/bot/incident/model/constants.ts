import type { SourceFile } from "./types.ts";

export const botEventsSourceName = "bot.events.ndjson";
export const botStderrSourceName = "bot.stderr.log";
export const launchesSourceName = "launches.ndjson";
export const logDirectoryLabel = "log directory";
export const scriptVersion = 1;
export const stderrUndatedLineLimit = 200;

export const baseSourceFiles: readonly SourceFile[] = [
  { kind: "launches", name: launchesSourceName, output: launchesSourceName },
];
