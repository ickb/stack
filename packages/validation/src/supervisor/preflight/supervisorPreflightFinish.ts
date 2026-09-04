import { writeIncident, writeSummary } from "../artifacts/supervisorArtifacts.ts";
import {
  STOP_EXIT_CODE,
  type ScenarioName,
} from "../runtime/shared/supervisorConstants.ts";
import { parsePreflightEvidence } from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassifiedCommandRun,
  CommandResult,
  ScenarioStep,
  SupervisorPlan,
  SupervisorRunState,
} from "../runtime/shared/supervisorTypes.ts";
import { preflightStateSummary } from "./supervisorPreflightState.ts";

export async function finishPreflightRun(
  ...[cycleIndex, scenario, step, plan, state, run]: [
    cycleIndex: number,
    scenario: ScenarioName,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    run: ClassifiedCommandRun | { stop: number },
  ]
): Promise<number | undefined> {
  if ("stop" in run) {
    return run.stop;
  }
  if (run.classification.terminal) {
    return stopForTerminalPreflight(cycleIndex, scenario, step, plan, state, run);
  }
  const report = parsePreflightEvidence(run.result.stdout).records[0];
  if (report !== undefined) {
    state.preflightState.push(preflightStateSummary(cycleIndex, step, plan, report));
  }
  return undefined;
}

async function stopForTerminalPreflight(
  ...[cycleIndex, scenario, step, plan, state, run]: [
    cycleIndex: number,
    scenario: ScenarioName,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    run: { result: CommandResult; classification: Classification },
  ]
): Promise<number> {
  state.classifications.push(run.classification);
  await writeIncident(
    plan,
    cycleIndex,
    step.actor,
    scenario,
    run.classification,
    run.result,
    state.artifacts,
  );
  await writeSummary(plan, state, run.classification.outcome);
  return STOP_EXIT_CODE;
}
