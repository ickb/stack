import { writeJsonArtifact, writeSummary } from "../../artifacts/supervisorArtifacts.ts";
import { wallClockBudgetStopDiagnostics } from "../../preflight/supervisorPreflightBudget.ts";
import { padCycle } from "../command/supervisorCommandRun.ts";
import { STOP_EXIT_CODE } from "./supervisorConstants.ts";
import { suggestedNextAction } from "./supervisorPublicState.ts";
import type {
  Classification,
  Dependencies,
  ParsedArgs,
  SupervisorPlan,
  SupervisorRunState,
} from "./supervisorTypes.ts";

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
  await writeSummary(
    plan,
    state,
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
  await writeJsonArtifact(
    plan,
    `cycle-${padCycle(cycleIndex)}-incident.json`,
    {
      runId: plan.runId,
      cycleIndex,
      actor: "bot",
      classification,
      artifacts: state.artifacts,
      suggestedNextAction: suggestedNextAction(classification),
    },
    state.artifacts,
    dependencies,
  );
  await writeSummary(plan, state, classification.outcome, dependencies);
  return STOP_EXIT_CODE;
}
