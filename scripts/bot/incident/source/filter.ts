import { processSourceLines } from "../io/filesystem.ts";
import { stderrUndatedLineLimit } from "../model/constants.ts";
import {
  isAsciiDigits,
  isRecord,
  scanAsciiDigits,
  stripLineEnding,
} from "../model/text.ts";
import type {
  FilteredSource,
  IncidentSummary,
  JsonFilteredSource,
  JsonSourceFilterOptions,
  SourceKind,
  StderrSourceFilterOptions,
} from "../model/types.ts";
import { collectArtifactRefs } from "./artifacts.ts";
import {
  appendSelectedStderrLine,
  appendSelectedUndatedStderrLine,
  emptySourceStats,
  rememberUndatedTail,
  summarizeBotEvent,
  summarizeLaunch,
  timestampInWindow,
  updateSourceStatsTimestamps,
} from "./summary.ts";

export async function filterJsonSource({
  dependencies,
  filePath,
  kind,
  sourceName,
  summary,
  window,
}: JsonSourceFilterOptions): Promise<JsonFilteredSource | null> {
  const selected: string[] = [];
  const stats = emptySourceStats();
  let updatedSummary = summary;

  const found = await processSourceLines(filePath, sourceName, dependencies, (line) => {
    if (line.trim() === "") {
      stats.emptyLines += 1;
      return;
    }
    stats.totalLines += 1;

    let record: unknown;
    try {
      record = JSON.parse(stripLineEnding(line));
    } catch {
      stats.malformedLines += 1;
      return;
    }

    const timestamp = parseRecordTimestamp(
      isRecord(record) ? record["timestamp"] : undefined,
    );
    if (timestamp === null) {
      stats.undatedLines += 1;
      return;
    }
    if (!timestampInWindow(timestamp, window)) {
      stats.outsideWindowLines += 1;
      return;
    }

    selected.push(line.endsWith("\n") ? line : `${line}\n`);
    stats.selectedLines += 1;
    Object.assign(stats, updateSourceStatsTimestamps(stats, timestamp));
    updatedSummary = summarizeJsonRecord(record, updatedSummary, timestamp, kind);
  });
  if (!found) {
    return null;
  }

  return { stats, summary: updatedSummary, text: selected.join("") };
}

export async function filterStderrSource({
  dependencies,
  filePath,
  sourceName,
  window,
}: StderrSourceFilterOptions): Promise<FilteredSource | null> {
  const selected: string[] = [];
  const stats = emptySourceStats();
  const undatedTail: Array<{ line: string }> = [];
  let selectedSinceLastTimestamp = false;

  const found = await processSourceLines(filePath, sourceName, dependencies, (line) => {
    if (line.trim() === "") {
      stats.emptyLines += 1;
      return;
    }
    stats.totalLines += 1;
    const timestamp = parseTextTimestamp(line);
    if (timestamp === null) {
      stats.undatedLines += 1;
      rememberUndatedTail(undatedTail, { line }, stderrUndatedLineLimit);
      Object.assign(
        stats,
        selectedSinceLastTimestamp
          ? appendSelectedUndatedStderrLine(selected, stats, line)
          : stats,
      );
      return;
    }
    stats.timestampedLines += 1;
    selectedSinceLastTimestamp = false;
    if (!timestampInWindow(timestamp, window)) {
      stats.outsideWindowLines += 1;
      return;
    }

    Object.assign(stats, appendSelectedStderrLine(selected, stats, line));
    selectedSinceLastTimestamp = true;
    Object.assign(stats, updateSourceStatsTimestamps(stats, timestamp));
  });
  if (!found) {
    return null;
  }

  if (selected.length === 0 && stats.undatedLines > 0 && stats.timestampedLines === 0) {
    for (const { line } of undatedTail) {
      Object.assign(stats, appendSelectedStderrLine(selected, stats, line));
    }
    stats.selectedUndatedLines = undatedTail.length;
    stats.undatedTailIncluded = true;
    stats.undatedTailLimit = stderrUndatedLineLimit;
  }

  return { stats, text: selected.join("") };
}

function summarizeJsonRecord(
  record: unknown,
  summary: IncidentSummary,
  timestamp: Date,
  kind: Exclude<SourceKind, "stderr">,
): IncidentSummary {
  return kind === "botEvents"
    ? collectArtifactRefs(record, summarizeBotEvent(record, summary, timestamp))
    : summarizeLaunch(record, summary, timestamp);
}

function parseRecordTimestamp(timestamp: unknown): Date | null {
  if (typeof timestamp !== "string") {
    return null;
  }
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTextTimestamp(line: string): Date | null {
  for (let index = 0; index < line.length; index += 1) {
    const timestamp = timestampTextAt(line, index);
    if (timestamp === null) {
      continue;
    }
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function timestampTextAt(line: string, start: number): string | null {
  if (!hasIsoTimestampBase(line, start)) {
    return null;
  }
  const fractionEnd = timestampFractionEnd(line, start + 19);
  if (fractionEnd === null) {
    return null;
  }
  const zoneLength = timestampZoneLength(line, fractionEnd);
  return zoneLength === 0 ? null : line.slice(start, fractionEnd + zoneLength);
}

function hasIsoTimestampBase(line: string, start: number): boolean {
  if (start + 19 > line.length) {
    return false;
  }
  const delimiters: ReadonlyArray<readonly [number, string]> = [
    [4, "-"],
    [7, "-"],
    [10, "T"],
    [13, ":"],
    [16, ":"],
  ];
  const digitRanges: ReadonlyArray<readonly [number, number]> = [
    [0, 4],
    [5, 7],
    [8, 10],
    [11, 13],
    [14, 16],
    [17, 19],
  ];
  return (
    delimiters.every(([offset, delimiter]) => line[start + offset] === delimiter) &&
    digitRanges.every(([from, until]) =>
      isAsciiDigits(line.slice(start + from, start + until)),
    )
  );
}

function timestampFractionEnd(line: string, start: number): number | null {
  if (line[start] !== ".") {
    return start;
  }
  const end = scanAsciiDigits(line, start + 1, 9);
  return end === start + 1 ? null : end;
}

function timestampZoneLength(line: string, start: number): number {
  if (line[start] === "Z") {
    return 1;
  }
  if (line[start] !== "+" && line[start] !== "-") {
    return 0;
  }
  return isAsciiDigits(line.slice(start + 1, start + 3)) &&
    line[start + 3] === ":" &&
    isAsciiDigits(line.slice(start + 4, start + 6))
    ? 6
    : 0;
}
