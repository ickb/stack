import { writeCommandArtifacts } from "../artifacts/supervisorArtifacts.ts";
import { classifyActorResult } from "../classification/supervisorClassification.ts";
import type {
  Classification,
  CommandResult,
  Dependencies,
  ScenarioStep,
  SupervisorPlan,
  SupervisorRunState,
} from "../runtime/shared/supervisorTypes.ts";
import {
  commandTimeoutOrStop,
  runPreflight,
  stepLabel,
} from "./supervisorPreflightStep.ts";

export function isRetryablePreflight(classification: Classification): boolean {
  return classification.outcome === "preflight_retryable_error";
}

export async function preparePreflightRetry(
  ...[cycleIndex, step, plan, state, firstResult, stopForUnavailableWallClockBudget]: [
    cycleIndex: number,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    firstResult: CommandResult,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
  ]
): Promise<number | undefined> {
  state.artifacts.push(
    ...(await writeCommandArtifacts(
      plan,
      cycleIndex,
      `${stepLabel(step)}-preflight-attempt-1`,
      firstResult,
    )),
  );
  return stopForUnavailableWallClockBudget(cycleIndex, "preflight_retry_start");
}

export async function retryPreflight(
  ...[
    cycleIndex,
    step,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    dependencies,
  ]: [
    cycleIndex: number,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
    wallClockDeadline: number | undefined,
    dependencies: Dependencies,
  ]
): Promise<{ result: CommandResult; classification: Classification } | { stop: number }> {
  const retryTimeout = await commandTimeoutOrStop(
    plan,
    wallClockDeadline,
    dependencies,
    cycleIndex,
    "preflight_retry_start",
    stopForUnavailableWallClockBudget,
  );
  if ("stop" in retryTimeout) {
    return { stop: retryTimeout.stop };
  }
  const result = await runPreflight(
    step.actor,
    plan,
    dependencies,
    retryTimeout.timeoutMs,
  );
  state.artifacts.push(
    ...(await writeCommandArtifacts(
      plan,
      cycleIndex,
      `${stepLabel(step)}-preflight-attempt-2`,
      result,
    )),
  );
  return { result, classification: classifyActorResult("preflight", result) };
}
