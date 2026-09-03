import { errorMessage, isRecord } from "../../../packages/node-utils/src/index.ts";
import {
  PREBUILD_COMMAND,
  type BoundedCommandResult,
  type CountRecord,
  type MissingSummaryInput,
  type SupervisorDecision,
  type SupervisorRun,
} from "./model.ts";

export function formatRunLine(run: SupervisorRun, decision: SupervisorDecision): string {
  const fields = [
    `loop run=${String(run.runIndex)}`,
    `status=${String(run.status)}`,
    `stopped=${run.stopped}`,
    `outcomes=${formatCounts(run.aggregateCounts)}`,
    `tx=${String(run.txCount)}`,
    `txOutcomes=${String(run.txCreatingOutcomeCount)}`,
    `new=${decision.newOutcomes.length === 0 ? "-" : decision.newOutcomes.join(",")}`,
    `stable=${String(decision.stableCount)}`,
    `state=${formatPublicState(run.publicState)}`,
    `decision=${decision.reason}`,
  ];
  if (run.stopDiagnosticReason !== undefined) {
    fields.push(`stop=${run.stopDiagnosticReason}`);
  }
  if (run.childError !== undefined) {
    fields.push(`child_error=${shellWord(run.childError)}`);
  }
  if (run.childSignal !== undefined) {
    fields.push(`signal=${shellWord(run.childSignal)}`);
  }
  fields.push(`out=${run.relativeOutDir}`);
  return fields.join(" ");
}

export function formatMissingSummaryLine({
  runIndex,
  relativeOutDir,
  status,
  error,
  spawnResult,
}: MissingSummaryInput): string {
  const fields = [
    `loop run=${String(runIndex)}`,
    `status=${String(status)}`,
    "summary=missing_or_invalid",
    `error=${shellWord(errorMessage(error))}`,
  ];
  const childError =
    spawnResult.error === undefined ? undefined : childSpawnError(spawnResult.error);
  if (childError !== undefined) {
    fields.push(`child_error=${shellWord(childError)}`);
  }
  if (typeof spawnResult.signal === "string" && spawnResult.signal.length > 0) {
    fields.push(`signal=${shellWord(spawnResult.signal)}`);
  }
  fields.push(`out=${relativeOutDir}`);
  return fields.join(" ");
}

export function formatPrebuildFailure(prebuild: BoundedCommandResult): string {
  const fields = [
    "loop prebuild_failed",
    "target=source",
    `status=${String(prebuild.status ?? 1)}`,
    `command=${shellWord(PREBUILD_COMMAND.join(" "))}`,
  ];
  if (typeof prebuild.signal === "string" && prebuild.signal.length > 0) {
    fields.push(`signal=${shellWord(prebuild.signal)}`);
  }
  const childError =
    prebuild.error === undefined ? undefined : childSpawnError(prebuild.error);
  if (childError !== undefined) {
    fields.push(`child_error=${shellWord(childError)}`);
  }
  return fields.join(" ");
}

function formatCounts(counts: CountRecord): string {
  const entries = sortedEntries(counts);
  return entries.length === 0
    ? "-"
    : entries.map(([key, value]) => `${key}:${String(value)}`).join(",");
}

function formatPublicState(state: Record<string, unknown> | null): string {
  if (!isRecord(state)) {
    return "-";
  }
  const keys = ["marketOrderCount", "userOrderCount", "receiptCount"];
  const fields = keys
    .filter((key) => typeof state[key] === "number")
    .map((key) => `${key}:${String(state[key])}`);
  return fields.length === 0 ? "-" : fields.join(",");
}

function sortedEntries(record: CountRecord): Array<[string, number]> {
  return Object.entries(record).toSorted(([left], [right]) => left.localeCompare(right));
}

function shellWord(value: unknown): string {
  return String(value).replaceAll(/\s+/gu, "_");
}

export function childSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return errorMessage(error);
}
