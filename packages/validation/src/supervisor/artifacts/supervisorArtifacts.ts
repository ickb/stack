import { appendFile, writeFile } from "node:fs/promises";
import { displayPath } from "../args/supervisorPaths.ts";
import { padCycle } from "../runtime/command/supervisorCommandRun.ts";
import {
  join,
  type Actor,
  type OutcomeKind,
} from "../runtime/shared/supervisorConstants.ts";
import { boundedText, jsonReplacer } from "../runtime/shared/supervisorEvidence.ts";
import { suggestedNextAction } from "../runtime/shared/supervisorPublicState.ts";
import {
  aggregateClassifications,
  coverageSummary,
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
  CoverageLedger,
  Dependencies,
  IncidentArtifact,
  PreflightStateSummary,
  PublicStateAssumption,
  ScenarioChoice,
  StopDiagnostics,
  SupervisorPlan,
  UnsupportedScenarioChoice,
} from "../runtime/shared/supervisorTypes.ts";
import { commandShape } from "./supervisorArtifactCommandShape.ts";

/**
 * Writes a terminal incident for unmet requested coverage outcomes.
 *
 * @remarks
 * The incident JSON path is appended to `artifacts` by `writeJsonArtifact`.
 */
export async function writeUnmetCoverageIncident(
  ...[plan, cycleIndex, unmetGoals, ledger, artifacts, dependencies, budgetLabel]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    unmetGoals: OutcomeKind[],
    ledger: CoverageLedger,
    artifacts: string[],
    dependencies: Dependencies,
    budgetLabel: string,
  ]
): Promise<IncidentArtifact> {
  const classification: Classification = {
    actor: "preflight",
    outcome: "unmet_coverage_goal",
    terminal: true,
    reason: `${budgetLabel} ended before observing requested outcomes: ${unmetGoals.join(", ")}`,
    txHashes: [],
    evidence: {
      recordsAccepted: 0,
      ignoredLineCount: 0,
      malformedLineCount: 0,
      exitStatus: null,
      signal: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  };
  const relativePath = await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    {
      runId: plan.runId,
      cycleIndex,
      actor: "supervisor",
      classification,
      unmetGoals,
      coverage: coverageSummary(ledger),
      artifacts,
      suggestedNextAction: suggestedNextAction(classification),
    },
    artifacts,
    dependencies,
  );
  return { relativePath, classification };
}

/**
 * Writes a terminal actor incident artifact.
 *
 * @remarks
 * The incident JSON path is appended to `artifacts` by `writeJsonArtifact`.
 */
export async function writeIncident(
  ...[
    plan,
    cycleIndex,
    actor,
    choice,
    classification,
    result,
    ledger,
    artifacts,
    dependencies,
  ]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    actor: Actor,
    choice: ScenarioChoice,
    classification: Classification,
    result: CommandResult,
    ledger: CoverageLedger,
    artifacts: string[],
    dependencies: Dependencies,
  ]
): Promise<IncidentArtifact> {
  const relativePath = await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    {
      runId: plan.runId,
      cycleIndex,
      actor,
      scenario: choice.scenario.name,
      targetOutcomes: choice.targetOutcomes,
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
      coverage: coverageSummary(ledger),
      stdoutExcerpt: boundedText(result.stdout, 4000),
      stderrExcerpt: boundedText(result.stderr, 4000),
      artifacts,
      suggestedNextAction: suggestedNextAction(classification),
    },
    artifacts,
    dependencies,
  );
  return { relativePath, classification };
}

export function unsupportedIncident(
  ...[plan, cycleIndex, choice, ledger, classification]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    choice: UnsupportedScenarioChoice,
    ledger: CoverageLedger,
    classification: Classification,
  ]
): Record<string, unknown> {
  return {
    runId: plan.runId,
    cycleIndex,
    actor: "supervisor",
    classification,
    requested: choice.requested,
    coverage: coverageSummary(ledger),
    suggestedNextAction:
      "provide an alternate ignored config or add a tested supervisor/test-harness control surface; do not mutate funded configs in place",
  };
}

/**
 * Writes the final supervisor summary artifact.
 *
 * @remarks
 * `writeJsonArtifact` appends `summary.json` to `artifacts` when it is not
 * already present.
 */
export async function writeSummary(
  ...[
    plan,
    ledger,
    classifications,
    artifacts,
    preflightState,
    latestPublicState,
    stopReason,
    dependencies,
    stopDiagnostics,
  ]: [
    plan: SupervisorPlan,
    ledger: CoverageLedger,
    classifications: Classification[],
    artifacts: string[],
    preflightState: PreflightStateSummary[],
    latestPublicState: PublicStateAssumption | undefined,
    stopReason: string,
    dependencies: Dependencies,
    stopDiagnostics?: StopDiagnostics,
  ]
): Promise<string> {
  return writeJsonArtifact(
    plan,
    "summary.json",
    {
      runId: plan.runId,
      stopped: stopReason,
      stopDiagnostics: stopDiagnostics ?? null,
      artifacts,
      aggregateCounts: aggregateClassifications(classifications),
      coverageGoalOutcomes: ledger.goals,
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
      scenarioAttempts: ledger.attempts,
      coverage: coverageSummary(ledger),
      publicVsOwnedStateAssumptions: latestPublicState ?? null,
    },
    artifacts,
    dependencies,
  );
}

/**
 * Writes stdout, stderr, and command-shape artifacts for one command result.
 *
 * @returns Repo-display paths for callers to record in run state.
 */
export async function writeCommandArtifacts(
  ...[plan, cycleIndex, label, result, dependencies]: [
    plan: SupervisorPlan,
    cycleIndex: number,
    label: string,
    result: CommandResult,
    dependencies: Dependencies,
  ]
): Promise<string[]> {
  const base = `cycle-${padCycle(cycleIndex)}-${label}`;
  const stdoutExtension = result.actor === "preflight" ? "json" : "ndjson";
  const stdoutPath = await writeTextArtifact(
    plan,
    `${base}.stdout.${stdoutExtension}`,
    result.stdout,
    dependencies,
  );
  const stderrPath = await writeTextArtifact(
    plan,
    `${base}.stderr.log`,
    result.stderr,
    dependencies,
  );
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
    dependencies,
  );
  return [stdoutPath, stderrPath, commandPath];
}

async function writeTextArtifact(
  plan: SupervisorPlan,
  fileName: string,
  text: string,
  dependencies: Dependencies,
): Promise<string> {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const artifactPath = join(plan.outDir, fileName);
  await writeFileFn(artifactPath, text);
  return displayPath(plan.rootDir, artifactPath);
}

/**
 * Writes JSON and records its display path in `artifacts` when new.
 */
export async function writeJsonArtifact(
  ...[plan, fileName, value, artifacts, dependencies]: [
    plan: SupervisorPlan,
    fileName: string,
    value: unknown,
    artifacts: string[],
    dependencies: Dependencies,
  ]
): Promise<string> {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  const artifactPath = join(plan.outDir, fileName);
  await writeFileFn(artifactPath, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
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
  dependencies: Dependencies,
): Promise<void> {
  const appendFileFn = dependencies.appendFile ?? appendFile;
  await appendFileFn(
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
