import { classifyActorResult } from "../classification/supervisorClassification.ts";
import {
  SCENARIO_STEPS,
  type ScenarioName,
} from "../runtime/shared/supervisorConstants.ts";
import type {
  Dependencies,
  ScenarioStep,
  SupervisorPlan,
  SupervisorRunState,
} from "../runtime/shared/supervisorTypes.ts";
import { finishPreflightRun } from "./supervisorPreflightFinish.ts";
import {
  isRetryablePreflight,
  preparePreflightRetry,
  retryPreflight,
} from "./supervisorPreflightRetry.ts";
import { commandTimeoutOrStop, runPreflight } from "./supervisorPreflightStep.ts";

/**
 * Runs all preflight steps for a chosen scenario.
 *
 * @returns `undefined` when all preflight steps pass, or a final process exit
 * code after a terminal preflight path has written required artifacts.
 */
export async function runPreflightSteps(
  ...[
    cycleIndex,
    scenario,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    dependencies,
  ]: [
    cycleIndex: number,
    scenario: ScenarioName,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
    wallClockDeadline: number | undefined,
    dependencies: Dependencies,
  ]
): Promise<number | undefined> {
  for (const step of SCENARIO_STEPS[scenario]) {
    const stop = await runPreflightStep(
      cycleIndex,
      scenario,
      step,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      dependencies,
    );
    if (stop !== undefined) {
      return stop;
    }
  }
  return undefined;
}

/**
 * Runs one preflight step, including one retry when the classification allows it.
 *
 * @returns `undefined` when actor execution may continue, or a final process
 * exit code after the stop path has written required artifacts.
 */
async function runPreflightStep(
  ...[
    cycleIndex,
    scenario,
    step,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    dependencies,
  ]: [
    cycleIndex: number,
    scenario: ScenarioName,
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
): Promise<number | undefined> {
  const firstTimeout = await commandTimeoutOrStop(
    plan,
    wallClockDeadline,
    dependencies,
    cycleIndex,
    "preflight_start",
    stopForUnavailableWallClockBudget,
  );
  if ("stop" in firstTimeout) {
    return firstTimeout.stop;
  }
  const firstResult = await runPreflight(
    step.actor,
    plan,
    dependencies,
    firstTimeout.timeoutMs,
  );
  const firstClassification = classifyActorResult("preflight", firstResult);
  const retryWallClockStop = isRetryablePreflight(firstClassification)
    ? await preparePreflightRetry(
        cycleIndex,
        step,
        plan,
        state,
        firstResult,
        stopForUnavailableWallClockBudget,
      )
    : undefined;
  if (retryWallClockStop !== undefined) {
    return retryWallClockStop;
  }

  const run = isRetryablePreflight(firstClassification)
    ? await retryPreflight(
        cycleIndex,
        step,
        plan,
        state,
        stopForUnavailableWallClockBudget,
        wallClockDeadline,
        dependencies,
      )
    : { result: firstResult, classification: firstClassification };
  return finishPreflightRun(cycleIndex, scenario, step, plan, state, run);
}
