import { appendFile, writeFile } from "node:fs/promises";
import { displayPath } from "../args/supervisorPaths.ts";
import { padCycle } from "../runtime/command/supervisorCommandRun.ts";
import {
  join,
  type Actor,
  type ScenarioName,
} from "../runtime/shared/supervisorConstants.ts";
import { boundedText, jsonReplacer } from "../runtime/shared/supervisorEvidence.ts";
import { suggestedNextAction } from "../runtime/shared/supervisorPublicState.ts";
import {
  aggregateClassifications,
  testerOrderEvidenceByOutcome,
  txCreatingHashCountTotal,
  txCreatingOutcomeCount,
  txCreatingUniqueHashCountTotal,
  txHashesByOutcome,
  uniqueTxHashesByOutcome,
} from "../runtime/shared/supervisorSummary.ts";
import type {
  Classification,
  CommandResult,
  IncidentArtifact,
  StopDiagnostics,
  SupervisorPlan,
  SupervisorRunState,
} from "../runtime/shared/supervisorTypes.ts";
import { commandShape } from "./supervisorArtifactCommandShape.ts";

/**
 * Writes a terminal actor incident artifact.
 *
 * @remarks
 * The incident JSON path is appended to `artifacts` by `writeJsonArtifact`.
 */
export async function writeIncident(
  ...[plan, cycleIndex, actor, scenario, classification, result, artifacts]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    actor: Actor,
    scenario: ScenarioName,
    classification: Classification,
    result: CommandResult,
    artifacts: string[],
  ]
): Promise<IncidentArtifact> {
  const relativePath = await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    {
      runId: plan.runId,
      cycleIndex,
      actor,
      scenario,
      command: commandShape(plan, result),
      exit: {
        spawnError: result.spawnError,
        status: result.status,
        signal: result.signal,
        timedOut: result.timedOut,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        elapsedMs: result.elapsedMs,
      },
      classification,
      stdoutExcerpt: boundedText(result.stdout, 4000),
      stderrExcerpt: boundedText(result.stderr, 4000),
      artifacts,
      suggestedNextAction: suggestedNextAction(classification),
    },
    artifacts,
  );
  return { relativePath, classification };
}

/**
 * Writes the final supervisor summary artifact.
 *
 * @remarks
 * `writeJsonArtifact` appends `summary.json` to `artifacts` when it is not
 * already present.
 */
export async function writeSummary(
  ...[plan, state, stopReason, stopDiagnostics]: [
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopReason: string,
    stopDiagnostics?: StopDiagnostics,
  ]
): Promise<string> {
  const { classifications, artifacts, preflightState, latestPublicState } = state;
  return writeJsonArtifact(
    plan,
    "summary.json",
    {
      runId: plan.runId,
      stopped: stopReason,
      stopDiagnostics: stopDiagnostics ?? null,
      artifacts,
      aggregateCounts: aggregateClassifications(classifications),
      requestedOutcomes: plan.targetOutcomes,
      txHashesByOutcome: txHashesByOutcome(classifications),
      uniqueTxHashesByOutcome: uniqueTxHashesByOutcome(classifications),
      txCreatingTxHashCount: txCreatingHashCountTotal(classifications),
      txCreatingUniqueTxHashCount: txCreatingUniqueHashCountTotal(classifications),
      txCreatingOutcomeCount: txCreatingOutcomeCount(classifications),
      testerOrderEvidence: testerOrderEvidenceByOutcome(classifications),
      skipReasons: classifications
        .map((item) => item.skipReason)
        .filter((item) => item !== undefined),
      retryableFailures: classifications.flatMap((item) => item.retryableFailures ?? []),
      preflightState,
      publicVsOwnedStateAssumptions: latestPublicState ?? null,
    },
    artifacts,
  );
}

/**
 * Writes stdout, stderr, and command-shape artifacts for one command result.
 *
 * @returns Repo-display paths for callers to record in run state.
 */
export async function writeCommandArtifacts(
  ...[plan, cycleIndex, label, result]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    label: string,
    result: CommandResult,
  ]
): Promise<string[]> {
  const base = `cycle-${padCycle(cycleIndex)}-${label}`;
  const stdoutExtension = result.actor === "preflight" ? "json" : "ndjson";
  const stdoutPath = await writeTextArtifact(
    plan,
    `${base}.stdout.${stdoutExtension}`,
    result.stdout,
  );
  const stderrPath = await writeTextArtifact(plan, `${base}.stderr.log`, result.stderr);
  const commandPath = await writeJsonArtifact(
    plan,
    `${base}.command.json`,
    {
      command: commandShape(plan, result),
      exit: {
        spawnError: result.spawnError,
        status: result.status,
        signal: result.signal,
        timedOut: result.timedOut,
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        elapsedMs: result.elapsedMs,
      },
    },
    [],
  );
  return [stdoutPath, stderrPath, commandPath];
}

async function writeTextArtifact(
  plan: SupervisorPlan,
  fileName: string,
  text: string,
): Promise<string> {
  const artifactPath = join(plan.outDir, fileName);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The output directory is validated once before deterministic artifact names are written.
  await writeFile(artifactPath, text);
  return displayPath(plan.rootDir, artifactPath);
}

/**
 * Writes JSON and records its display path in `artifacts` when new.
 */
export async function writeJsonArtifact(
  ...[plan, fileName, value, artifacts]: [
    plan: SupervisorPlan,
    fileName: string,
    value: unknown,
    artifacts: string[],
  ]
): Promise<string> {
  const artifactPath = join(plan.outDir, fileName);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The output directory is validated once before deterministic artifact names are written.
  await writeFile(artifactPath, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
  const relativePath = displayPath(plan.rootDir, artifactPath);
  if (!artifacts.includes(relativePath)) {
    artifacts.push(relativePath);
  }
  return relativePath;
}

/**
 * Appends one supervisor event record to `supervisor.ndjson`.
 */
export async function appendSupervisorEvent(
  plan: SupervisorPlan,
  fields: Record<string, unknown>,
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The output directory is validated once before the fixed event-log name is written.
  await appendFile(
    join(plan.outDir, "supervisor.ndjson"),
    `${JSON.stringify(
      {
        version: 1,
        app: "supervisor",
        runId: plan.runId,
        timestamp: new Date().toISOString(),
        ...fields,
      },
      jsonReplacer,
    )}\n`,
  );
}
