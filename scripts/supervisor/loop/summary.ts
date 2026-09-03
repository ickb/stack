import {
  INSPECTION_REQUIRED_EXIT_CODE,
  SUMMARY_TOKEN_PATTERN,
  type CountRecord,
  type DecisionReason,
  type DecisionRun,
  type JsonValue,
  type RunSummaryInput,
  type SummaryRecord,
  type SupervisorDecision,
  type SupervisorRun,
} from "./model.ts";

export function summarizeRun(
  summary: SummaryRecord,
  { runIndex, relativeOutDir, status }: RunSummaryInput,
): SupervisorRun {
  const aggregateCounts = countRecord(summary.aggregateCounts);
  const txCount = requiredCount(summary.txCreatingTxHashCount, "txCreatingTxHashCount");
  const txCreatingOutcomeCount = requiredCount(
    summary.txCreatingOutcomeCount,
    "txCreatingOutcomeCount",
  );
  const hasTxCreatingOutcome = txCreatingOutcomeCount > 0;
  const artifacts = requiredStringArray(summary.artifacts, "artifacts");
  return {
    runIndex,
    relativeOutDir,
    status,
    stopped: stoppedToken(summary.stopped),
    aggregateCounts,
    outcomes: Object.entries(aggregateCounts)
      .filter(([, count]) => count > 0)
      .map(([key]) => key)
      .toSorted((left, right) => left.localeCompare(right)),
    txCount,
    txCreatingOutcomeCount,
    hasTxCreatingOutcome,
    hasIncident: artifacts.some((artifact) => artifact.endsWith("incident.json")),
    skipReasons: stringArray(summary.skipReasons),
    stopDiagnosticReason: stopDiagnosticReason(summary.stopDiagnostics),
    publicState: isRecord(summary.publicVsOwnedStateAssumptions)
      ? summary.publicVsOwnedStateAssumptions
      : null,
    signature: summarySignature(summary),
  };
}

export function decideNext({
  run,
  priorOutcomes,
  previousSignature,
  stableCount,
  stableLimit,
  runIndex,
  maxRuns,
}: {
  run: DecisionRun;
  priorOutcomes: ReadonlySet<string>;
  previousSignature: string | undefined;
  stableCount: number;
  stableLimit: number;
  runIndex: number;
  maxRuns: number;
}): SupervisorDecision {
  const newOutcomes = run.outcomes.filter((outcome) => !priorOutcomes.has(outcome));
  const nextStableCount = previousSignature === run.signature ? stableCount + 1 : 1;
  if (run.hasIncident) {
    return stopDecision("incident", newOutcomes, nextStableCount, 2);
  }
  if (run.status !== 0) {
    return stopDecision("supervisor_nonzero", newOutcomes, nextStableCount, run.status);
  }
  if (run.txCount > 0 || run.hasTxCreatingOutcome === true) {
    return stopDecision("tx_observed", newOutcomes, nextStableCount, 0);
  }
  if (runIndex > 1 && newOutcomes.length > 0) {
    return stopDecision("new_outcome", newOutcomes, nextStableCount, 0);
  }
  if (runIndex >= maxRuns) {
    return stopDecision(
      "max_runs",
      newOutcomes,
      nextStableCount,
      INSPECTION_REQUIRED_EXIT_CODE,
    );
  }
  if (nextStableCount >= stableLimit) {
    return stopDecision(
      "stable_no_progress",
      newOutcomes,
      nextStableCount,
      INSPECTION_REQUIRED_EXIT_CODE,
    );
  }
  return {
    action: "continue",
    reason: "continue",
    newOutcomes,
    stableCount: nextStableCount,
    exitCode: 0,
  };
}

function stopDecision(
  reason: Exclude<DecisionReason, "continue">,
  newOutcomes: string[],
  stableCount: number,
  exitCode: number,
): SupervisorDecision {
  return { action: "stop", reason, newOutcomes, stableCount, exitCode };
}

export function summarySignature(summary: SummaryRecord): string {
  return JSON.stringify({
    stopped: stoppedToken(summary.stopped),
    aggregateCounts: sortedEntries(countRecord(summary.aggregateCounts)),
    skipReasons: stringArray(summary.skipReasons).toSorted((left, right) =>
      left.localeCompare(right),
    ),
    testerOrderEvidence: normalizeJson(summary.testerOrderEvidence ?? null),
    preflightState: normalizeJson(summary.preflightState ?? null),
    publicVsOwnedStateAssumptions: normalizeJson(
      summary.publicVsOwnedStateAssumptions ?? null,
    ),
  });
}

function countRecord(value: unknown): CountRecord {
  if (!isRecord(value)) {
    throw new Error("summary.json aggregateCounts missing or invalid");
  }
  const counts: CountRecord = {};
  for (const [key, item] of Object.entries(value)) {
    requireSummaryToken(key, "aggregateCounts key");
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) {
      throw new Error("summary.json aggregateCounts missing or invalid");
    }
    if (item > 0) {
      counts[key] = item;
    }
  }
  return counts;
}

function stoppedToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("summary.json stopped missing or invalid");
  }
  return requireSummaryToken(value, "stopped");
}

function requireSummaryToken(value: string, key: string): string {
  if (!SUMMARY_TOKEN_PATTERN.test(value)) {
    throw new Error(`summary.json ${key} missing or invalid`);
  }
  return value;
}

function sortedEntries(record: CountRecord): Array<[string, number]> {
  return Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right));
}

function requiredCount(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`summary.json ${key} missing or invalid`);
  }
  return value;
}

function normalizeJson(value: unknown): JsonValue {
  let normalized: JsonValue;
  if (Array.isArray(value)) {
    normalized = value.map(normalizeJson);
  } else if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    normalized = value;
  } else if (!isRecord(value)) {
    normalized = null;
  } else {
    normalized = Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeJson(item)]),
    );
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function stopDiagnosticReason(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value["reason"] !== "string") {
    return undefined;
  }
  return requireSummaryToken(value["reason"], "stopDiagnostics reason");
}

function requiredStringArray(value: unknown, key: string): string[] {
  const strings = stringArray(value);
  if (!Array.isArray(value) || strings.length !== value.length) {
    throw new Error(`summary.json ${key} missing or invalid`);
  }
  return strings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
