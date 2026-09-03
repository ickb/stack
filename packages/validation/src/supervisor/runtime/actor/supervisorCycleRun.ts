import { appendSupervisorEvent } from "../../artifacts/supervisorArtifacts.ts";
import { runPreflightSteps } from "../../preflight/supervisorPreflightRun.ts";
import type { ScenarioName } from "../shared/supervisorConstants.ts";
import type {
  ParsedArgs,
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
  const scenario = scenarioForCycle(args, state);
  await appendSupervisorEvent(
    plan,
    { type: "cycle.started", cycleIndex, scenario },
    dependencies,
  );
  return (
    (await runPreflightSteps(
      cycleIndex,
      scenario,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      dependencies,
    )) ??
    (await runActorSteps(
      cycleIndex,
      scenario,
      args,
      plan,
      state,
      stopForUnavailableWallClockBudget,
      wallClockDeadline,
      dependencies,
    ))
  );
}

// A committed bot transaction must be followed by a bot balance read before any
// tester step, so the audit cycle runs the bot alone regardless of the request.
function scenarioForCycle(args: ParsedArgs, state: SupervisorRunState): ScenarioName {
  return state.pendingBotBalanceAudit === undefined ? args.scenario : "bot-only";
}
