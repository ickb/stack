import { appendSupervisorEvent } from "../../artifacts/supervisorArtifacts.ts";
import { runPreflightSteps } from "../../preflight/supervisorPreflightRun.ts";
import {
  chooseScenario,
  recordScenarioAttempt,
  scenarioByName,
} from "../shared/supervisorCoverage.ts";
import { stopForUnsupportedChoice } from "../shared/supervisorStops.ts";
import type {
  ParsedArgs,
  ScenarioChoiceResult,
  SupervisorDependencies,
  SupervisorPlan,
  SupervisorRunState,
} from "../shared/supervisorTypes.ts";
import { runActorSteps } from "./supervisorActorRun.ts";

/**
 * Runs one supervisor scenario cycle.
 *
 * @returns `undefined` when the supervisor should continue, or a final process
 * exit code after the stop path has written required artifacts.
 */
export async function runSupervisorCycle(
  ...[
    cycleIndex,
    args,
    plan,
    state,
    stopForUnavailableWallClockBudget,
    wallClockDeadline,
    dependencies,
  ]: [
    cycleIndex: number,
    args: ParsedArgs,
    plan: SupervisorPlan,
    state: SupervisorRunState,
    stopForUnavailableWallClockBudget: (
      incidentCycleIndex: number,
      stage: string,
    ) => Promise<number | undefined>,
    wallClockDeadline: number | undefined,
    dependencies: SupervisorDependencies,
  ]
): Promise<number | undefined> {
  const cycleWallClockStop = await stopForUnavailableWallClockBudget(
    Math.max(1, cycleIndex - 1),
    "cycle_start",
  );
  if (cycleWallClockStop !== undefined) {
    return cycleWallClockStop;
  }
  const choice = chooseScenarioForCycle(args, state);
  recordScenarioAttempt(state.ledger, cycleIndex, choice);
  if (choice.kind === "unsupported") {
    return stopForUnsupportedChoice(cycleIndex, choice, plan, state, dependencies);
  }
  await appendSupervisorEvent(
    plan,
    {
      type: "cycle.started",
      cycleIndex,
      scenario: choice.scenario.name,
      targetOutcomes: choice.targetOutcomes,
      reason: choice.reason,
    },
    dependencies,
  );
  return (
    (await runPreflightSteps(
      cycleIndex,
      choice,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      dependencies,
    )) ??
    (await runActorSteps(
      cycleIndex,
      choice,
      args,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      dependencies,
    ))
  );
}

function chooseScenarioForCycle(
  args: ParsedArgs,
  state: SupervisorRunState,
): ScenarioChoiceResult {
  if (state.pendingBotBalanceAudit === undefined) {
    return chooseScenario(args, state.ledger);
  }
  const scenario = scenarioByName("bot-only");
  return {
    kind: "scenario",
    scenario,
    targetOutcomes: scenario.targetOutcomes,
    reason: "bot-only cycle selected to resolve pending bot balance audit",
  };
}
