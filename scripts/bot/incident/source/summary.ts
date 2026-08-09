import { randomBytes } from "node:crypto";
import path from "node:path";

import { scriptVersion } from "../model/constants.ts";
import { shellQuote } from "../model/paths.ts";
import { isRecord } from "../model/text.ts";
import type {
  BotEventsSummary,
  CompleteIncidentSummary,
  CountMap,
  FilteredSource,
  GroupedTextMap,
  IncidentSummary,
  LaunchesSummary,
  SourceFile,
  SourceStats,
  SourceWindow,
  TimestampSummary,
} from "../model/types.ts";

export function createSummary({
  createdAt,
  logDir,
  logRoot,
  logRootSource,
  since,
  until,
}: {
  createdAt: Date;
  logDir: string;
  logRoot: string;
  logRootSource: string;
  since: Date;
  until: Date;
}): IncidentSummary {
  return {
    version: 1,
    scriptVersion,
    createdAt: createdAt.toISOString(),
    window: {
      since: since.toISOString(),
      until: until.toISOString(),
    },
    logRoot,
    logRootSource,
    logDir,
    sourceFiles: [],
    sources: {},
    artifacts: {
      included: [],
      missing: [],
      mismatched: [],
    },
    botEvents: {
      countsByType: {},
      failureReasons: {},
      firstTimestamp: null,
      lastTimestamp: null,
      skipReasons: {},
      txHashesByOutcome: {},
    },
    launches: {
      countsByType: {},
      exitCodes: {},
      firstTimestamp: null,
      lastTimestamp: null,
      signals: {},
    },
    stderr: {
      firstTimestamp: null,
      lastTimestamp: null,
    },
  };
}

export function buildCompleteSummary({
  createdAt,
  incidentParent,
  summary,
}: {
  createdAt: Date;
  incidentParent: string;
  summary: IncidentSummary;
}): CompleteIncidentSummary {
  const incidentId = buildIncidentId(createdAt);
  const incidentDir = path.join(incidentParent, incidentId);
  return {
    ...summary,
    incidentDir,
    incidentId,
    compression: {
      created: false,
      command: compressionCommand(incidentParent, incidentId),
      reason: "The collector avoids assuming tar/gzip/zstd binaries are present.",
    },
  };
}

export function incidentReadme(summary: CompleteIncidentSummary): string {
  return [
    `Incident: ${summary.incidentId}`,
    `Window: ${summary.window.since} to ${summary.window.until}`,
    `Log directory: ${summary.logDir}`,
    "",
    "Files are source-separated: bot event logs, bot stderr logs, and launches.ndjson are never merged.",
    "summary.json contains event counts, transaction outcomes, skip/failure reasons, exit codes, and source inclusion stats.",
    "version.json contains collector, package, Node, and git metadata. Config files and environment dumps are intentionally not included.",
    "",
    `Compression command: ${summary.compression.command}`,
    "",
  ].join("\n");
}

export function appendMissingSource(
  summary: IncidentSummary,
  output: string,
  sourcePath: string,
): IncidentSummary {
  return {
    ...summary,
    sources: {
      ...summary.sources,
      [output]: {
        included: false,
        path: sourcePath,
        reason: "missing",
      },
    },
  };
}

export function appendSourceResult(
  summary: IncidentSummary,
  source: SourceFile,
  sourcePath: string,
  result: FilteredSource,
): IncidentSummary {
  return {
    ...summary,
    sourceFiles: [
      ...summary.sourceFiles,
      {
        name: source.name,
        output: source.output,
        path: sourcePath,
        selectedLines: result.stats.selectedLines,
      },
    ],
    sources: {
      ...summary.sources,
      [source.output]: {
        included: true,
        output: source.output,
        path: sourcePath,
        ...result.stats,
      },
    },
    stderr:
      source.kind === "stderr"
        ? {
            firstTimestamp: result.stats.firstTimestamp,
            lastTimestamp: result.stats.lastTimestamp,
          }
        : summary.stderr,
  };
}

export function emptySourceStats(): SourceStats {
  return {
    emptyLines: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    malformedLines: 0,
    outsideWindowLines: 0,
    selectedLines: 0,
    selectedUndatedLines: 0,
    timestampedLines: 0,
    totalLines: 0,
    undatedTailIncluded: false,
    undatedTailLimit: null,
    undatedLines: 0,
  };
}

export function rememberUndatedTail(
  tail: Array<{ line: string }>,
  entry: { line: string },
  limit: number,
): void {
  tail.push(entry);
  if (tail.length > limit) {
    tail.shift();
  }
}

export function appendSelectedStderrLine(
  selected: string[],
  stats: SourceStats,
  line: string,
): SourceStats {
  selected.push(line.endsWith("\n") ? line : `${line}\n`);
  return { ...stats, selectedLines: stats.selectedLines + 1 };
}

export function appendSelectedUndatedStderrLine(
  selected: string[],
  stats: SourceStats,
  line: string,
): SourceStats {
  return {
    ...appendSelectedStderrLine(selected, stats, line),
    selectedUndatedLines: stats.selectedUndatedLines + 1,
  };
}

export function timestampInWindow(
  timestamp: Date,
  { since, until }: SourceWindow,
): boolean {
  const value = timestamp.getTime();
  return since.getTime() <= value && value <= until.getTime();
}

export function updateSourceStatsTimestamps(
  stats: SourceStats,
  timestamp: Date,
): SourceStats {
  return { ...stats, ...updatedTimestampSummary(stats, timestamp) };
}

export function summarizeBotEvent(
  record: unknown,
  summary: IncidentSummary,
  timestamp: Date,
): IncidentSummary {
  if (!isRecord(record)) {
    return summary;
  }
  if (
    record["app"] !== "bot" ||
    typeof record["type"] !== "string" ||
    !record["type"].startsWith("bot.")
  ) {
    return summary;
  }

  let botEvents: BotEventsSummary = {
    ...summary.botEvents,
    ...updatedTimestampSummary(summary.botEvents, timestamp),
    countsByType: increment(summary.botEvents.countsByType, record["type"]),
  };
  if (typeof record["outcome"] === "string" && typeof record["txHash"] === "string") {
    botEvents = {
      ...botEvents,
      txHashesByOutcome: addGroupedUnique(
        botEvents.txHashesByOutcome,
        record["outcome"],
        record["txHash"],
      ),
    };
  }
  if (record["type"] === "bot.decision.skipped") {
    botEvents = {
      ...botEvents,
      skipReasons: increment(botEvents.skipReasons, stringReason(record["reason"])),
    };
  }
  if (
    record["type"] === "bot.transaction.failed" ||
    record["type"] === "bot.iteration.failed"
  ) {
    botEvents = {
      ...botEvents,
      failureReasons: increment(botEvents.failureReasons, failureReason(record)),
    };
  }
  return { ...summary, botEvents };
}

export function summarizeLaunch(
  record: unknown,
  summary: IncidentSummary,
  timestamp: Date,
): IncidentSummary {
  if (!isRecord(record)) {
    return summary;
  }
  if (record["app"] !== "bot-launcher" || typeof record["type"] !== "string") {
    return summary;
  }

  let launches: LaunchesSummary = {
    ...summary.launches,
    ...updatedTimestampSummary(summary.launches, timestamp),
    countsByType: increment(summary.launches.countsByType, record["type"]),
  };
  const status = summaryValueKey(record["status"]);
  if (status !== null) {
    launches = { ...launches, exitCodes: increment(launches.exitCodes, status) };
  }
  const signal = summaryValueKey(record["signal"]);
  if (signal !== null) {
    launches = { ...launches, signals: increment(launches.signals, signal) };
  }
  return { ...summary, launches };
}

function compressionCommand(incidentParent: string, incidentId: string): string {
  const archivePath = path.join(incidentParent, `${incidentId}.tar.gz`);
  return `tar -czf ${shellQuote(archivePath)} -C ${shellQuote(incidentParent)} ${shellQuote(incidentId)}`;
}

function buildIncidentId(createdAt: Date): string {
  const stamp = createdAt.toISOString().replaceAll(/[-:.]/gu, "");
  return `${stamp}-${process.pid.toString(36)}-${randomBytes(3).toString("hex")}`;
}

function updatedTimestampSummary(
  summary: TimestampSummary,
  timestamp: Date,
): TimestampSummary {
  const iso = timestamp.toISOString();
  return {
    firstTimestamp:
      summary.firstTimestamp === null || iso < summary.firstTimestamp
        ? iso
        : summary.firstTimestamp,
    lastTimestamp:
      summary.lastTimestamp === null || iso > summary.lastTimestamp
        ? iso
        : summary.lastTimestamp,
  };
}

function summaryValueKey(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  const json = JSON.stringify(value);
  return typeof json === "string" ? json : null;
}

function increment(counts: CountMap, key: string): CountMap {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

function addGroupedUnique(
  groups: GroupedTextMap,
  key: string,
  value: string,
): GroupedTextMap {
  const existing = groups[key] ?? [];
  if (existing.includes(value)) {
    return groups;
  }
  return { ...groups, [key]: [...existing, value] };
}

function stringReason(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "<missing>";
}

function failureReason(record: Record<string, unknown>): string {
  if (
    record["type"] === "bot.iteration.failed" &&
    record["retryBudgetExhausted"] === true
  ) {
    return "retry_budget_exhausted";
  }
  const error = record["error"];
  return (
    firstNonEmptyString([
      record["outcome"],
      record["reason"],
      error,
      isRecord(error) ? error["message"] : undefined,
      isRecord(error) ? error["name"] : undefined,
    ]) ?? "<missing>"
  );
}

function firstNonEmptyString(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return null;
}
