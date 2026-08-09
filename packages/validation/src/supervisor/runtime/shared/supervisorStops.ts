import {
  unsupportedIncident,
  writeJsonArtifact,
  writeSummary,
  writeUnmetCoverageIncident,
} from "../../artifacts/supervisorArtifacts.ts";
import { wallClockBudgetStopDiagnostics } from "../../preflight/supervisorPreflightBudget.ts";
import { padCycle } from "../command/supervisorCommandRun.ts";
import { STOP_EXIT_CODE } from "./supervisorConstants.ts";
import {
  recordClassificationCoverage,
  unmetExplicitGoals,
  unsupportedClassification,
} from "./supervisorCoverage.ts";
import { coverageSummary } from "./supervisorSummary.ts";
import type {
  Classification,
  Dependencies,
  ParsedArgs,
  SupervisorPlan,
  SupervisorRunState,
  UnsupportedScenarioChoice,
} from "./supervisorTypes.ts";

export async function stopForUnsupportedChoice(
  ...[cycleIndex, choice, plan, state, dependencies]: [
    cycleIndex: number,
    choice: UnsupportedScenarioChoice,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    dependencies: Dependencies,
  ]
): Promise<number> {
  const classification = unsupportedClassification(choice);
  state.classifications.push(classification);
  const incident = unsupportedIncident(
    plan,
    cycleIndex,
    choice,
    state.ledger,
    classification,
  );
  await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    incident,
    state.artifacts,
    dependencies,
  );
  await writeSummary(
    plan,
    state.ledger,
    state.classifications,
    state.artifacts,
    state.preflightState,
    state.latestPublicState,
    "unsupported_scenario",
    dependencies,
  );
  return STOP_EXIT_CODE;
}

export async function stopForWallClockBudget(
  ...[
    args,
    plan,
    state,
    wallClockDeadline,
    dependencies,
    incidentCycleIndex,
    stage,
    observedRemainingWallClockMs,
  ]: [
    args: ParsedArgs,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    wallClockDeadline: number | undefined,
    dependencies: Dependencies,
    incidentCycleIndex: number,
    stage: string,
    observedRemainingWallClockMs?: number,
  ]
): Promise<number | undefined> {
  const stopDiagnostics = wallClockBudgetStopDiagnostics(
    args,
    plan,
    wallClockDeadline,
    dependencies,
    incidentCycleIndex,
    stage,
    observedRemainingWallClockMs,
  );
  if (stopDiagnostics === undefined) {
    return undefined;
  }
  const pendingAuditStop = await stopForPendingBotBalanceAudit(
    incidentCycleIndex,
    plan,
    state,
    dependencies,
  );
  if (pendingAuditStop !== undefined) {
    return pendingAuditStop;
  }
  const unmetGoals = unmetExplicitGoals(args, state.ledger);
  if (unmetGoals.length > 0) {
    const incident = await writeUnmetCoverageIncident(
      plan,
      incidentCycleIndex,
      unmetGoals,
      state.ledger,
      state.artifacts,
      dependencies,
      "bounded wall-clock budget",
    );
    state.classifications.push(incident.classification);
    await writeSummary(
      plan,
      state.ledger,
      state.classifications,
      state.artifacts,
      state.preflightState,
      state.latestPublicState,
      incident.classification.outcome,
      dependencies,
      stopDiagnostics,
    );
    return STOP_EXIT_CODE;
  }
  await writeSummary(
    plan,
    state.ledger,
    state.classifications,
    state.artifacts,
    state.preflightState,
    state.latestPublicState,
    "max_wall_clock_seconds",
    dependencies,
    stopDiagnostics,
  );
  return 0;
}

export async function stopForPendingBotBalanceAudit(
  ...[cycleIndex, plan, state, dependencies]: [
    cycleIndex: number,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    dependencies: Dependencies,
  ]
): Promise<number | undefined> {
  if (state.pendingBotBalanceAudit === undefined) {
    return undefined;
  }
  const classification: Classification = {
    actor: "bot",
    outcome: "malformed_evidence",
    terminal: true,
    reason:
      "bot committed transaction evidence was not followed by next-cycle balance evidence before supervisor stop",
    txHashes: state.pendingBotBalanceAudit.txHashes,
    actions: state.pendingBotBalanceAudit.actions,
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
  state.classifications.push(classification);
  recordClassificationCoverage(state.ledger, classification);
  await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    {
      runId: plan.runId,
      cycleIndex,
      actor: "bot",
      classification,
      coverage: coverageSummary(state.ledger),
      artifacts: state.artifacts,
    },
    state.artifacts,
    dependencies,
  );
  await writeSummary(
    plan,
    state.ledger,
    state.classifications,
    state.artifacts,
    state.preflightState,
    state.latestPublicState,
    classification.outcome,
    dependencies,
  );
  return STOP_EXIT_CODE;
}

export async function stopForUnmetGoals(
  args: ParsedArgs,
  plan: SupervisorPlan,
  state: SupervisorRunState,
  dependencies: Dependencies,
): Promise<number | undefined> {
  const unmetGoals = unmetExplicitGoals(args, state.ledger);
  if (unmetGoals.length === 0) {
    return undefined;
  }
  const incident = await writeUnmetCoverageIncident(
    plan,
    args.maxCycles,
    unmetGoals,
    state.ledger,
    state.artifacts,
    dependencies,
    "bounded cycle budget",
  );
  state.classifications.push(incident.classification);
  await writeSummary(
    plan,
    state.ledger,
    state.classifications,
    state.artifacts,
    state.preflightState,
    state.latestPublicState,
    incident.classification.outcome,
    dependencies,
  );
  return STOP_EXIT_CODE;
}
