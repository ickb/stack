import pathModule from "node:path";

import { safeReaddir } from "../io/filesystem.ts";
import {
  baseSourceFiles,
  botEventsSourceName,
  botStderrSourceName,
} from "../model/constants.ts";
import { isAsciiDigits, isErrorCode } from "../model/text.ts";
import type { IncidentDependencies, SourceFile } from "../model/types.ts";

const { join } = pathModule;

export async function discoverSourceFiles(
  logDir: string,
  dependencies: IncidentDependencies,
): Promise<SourceFile[]> {
  const names = await sourceFileNames(logDir, dependencies);
  const eventNames = names.filter(isBotEventsSourceName).toSorted(nameCompare);
  const stderrNames = names.filter(isBotStderrSourceName).toSorted(nameCompare);
  return [
    ...(eventNames.length === 0
      ? [
          {
            kind: "botEvents",
            name: botEventsSourceName,
            output: botEventsSourceName,
          } satisfies SourceFile,
        ]
      : eventNames.map<SourceFile>((name) => ({
          kind: "botEvents",
          name,
          output: name,
        }))),
    ...(stderrNames.length === 0
      ? [
          {
            kind: "stderr",
            name: botStderrSourceName,
            output: botStderrSourceName,
          } satisfies SourceFile,
        ]
      : stderrNames.map<SourceFile>((name) => ({ kind: "stderr", name, output: name }))),
    ...baseSourceFiles,
  ];
}

async function sourceFileNames(
  logDir: string,
  dependencies: IncidentDependencies,
): Promise<string[]> {
  try {
    const entries = await (dependencies.readdir ?? safeReaddir)(logDir, {
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function isBotEventsSourceName(name: string): boolean {
  return (
    name === botEventsSourceName || isSlottedSourceName(name, "bot.events.", ".ndjson")
  );
}

function isBotStderrSourceName(name: string): boolean {
  return name === botStderrSourceName || isSlottedSourceName(name, "bot.stderr.", ".log");
}

function isSlottedSourceName(name: string, prefix: string, suffix: string): boolean {
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
    return false;
  }
  const slot = name.slice(prefix.length, -suffix.length);
  return (
    slot.length === "slot-00".length &&
    slot.startsWith("slot-") &&
    isAsciiDigits(slot.slice("slot-".length))
  );
}

function nameCompare(left: string, right: string): number {
  return left.localeCompare(right);
}

export function sourcePath(logDir: string, source: SourceFile): string {
  return join(logDir, source.name);
}
