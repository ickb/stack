import { writeIncident, writeSummary } from "../artifacts/supervisorArtifacts.ts";
import { STOP_EXIT_CODE } from "../runtime/shared/supervisorConstants.ts";
import { parsePreflightEvidence } from "../runtime/shared/supervisorEvidence.ts";
import type {
  Classification,
  ClassifiedCommandRun,
  CommandResult,
  Dependencies,
  ScenarioChoice,
  ScenarioStep,
  SupervisorPlan,
  SupervisorRunState,
} from "../runtime/shared/supervisorTypes.ts";
import { preflightStateSummary } from "./supervisorPreflightState.ts";

export async function finishPreflightRun(
  ...[cycleIndex, choice, step, plan, state, run, dependencies]: [
    cycleIndex: number,
    choice: ScenarioChoice,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    run: ClassifiedCommandRun | { stop: number },
    dependencies: Dependencies,
  ]
): Promise<number | undefined> {
  if ("stop" in run) {
    return run.stop;
  }
  if (run.classification.terminal) {
    return stopForTerminalPreflight(
      cycleIndex,
      choice,
      step,
      plan,
      state,
      run,
      dependencies,
    );
  }
  recordPreflightState(cycleIndex, choice, step, plan, state, run.result);
  return undefined;
}

function recordPreflightState(
  ...[cycleIndex, choice, step, plan, state, result]: [
    cycleIndex: number,
    choice: ScenarioChoice,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    result: CommandResult,
  ]
): void {
  const report = parsePreflightEvidence(result.stdout).records[0];
  if (report !== undefined) {
    state.preflightState.push(
      preflightStateSummary(cycleIndex, step, plan, choice.targetOutcomes, report),
    );
  }
}

async function stopForTerminalPreflight(
  ...[cycleIndex, choice, step, plan, state, run, dependencies]: [
    cycleIndex: number,
    choice: ScenarioChoice,
    step: ScenarioStep,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    run: { result: CommandResult; classification: Classification },
    dependencies: Dependencies,
  ]
): Promise<number> {
  state.classifications.push(run.classification);
  await writeIncident(
    plan,
    cycleIndex,
    step.actor,
    choice,
    run.classification,
    run.result,
    state.ledger,
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
    run.classification.outcome,
    dependencies,
  );
  return STOP_EXIT_CODE;
}
