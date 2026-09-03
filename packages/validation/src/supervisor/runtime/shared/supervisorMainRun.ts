import { writeSummary } from "../../artifacts/supervisorArtifacts.ts";
import { runSupervisorCycle } from "../actor/supervisorCycleRun.ts";
import {
  assertBuiltRuntime,
  now,
  prepareOutputDirectory,
} from "../command/supervisorCommandRun.ts";
import {
  stopForPendingBotBalanceAudit,
  stopForWallClockBudget,
} from "./supervisorStops.ts";
import type {
  ParsedArgs,
  StopForUnavailableWallClockBudget,
  SupervisorDependencies,
  SupervisorPlan,
  SupervisorRunState,
} from "./supervisorTypes.ts";

/**
 * Runs one supervisor session from parsed arguments and a resolved plan.
 *
 * @remarks Controlled stop conditions return supervisor exit codes after writing artifacts; unexpected infrastructure failures still throw.
 */
export async function supervise(
  args: ParsedArgs,
  plan: SupervisorPlan,
  dependencies: SupervisorDependencies,
): Promise<number> {
  const startedAt = now(dependencies);
  const wallClockDeadline =
    args.maxWallClockSeconds === undefined
      ? undefined
      : startedAt + args.maxWallClockSeconds * 1000;
  if (dependencies.skipBuiltRuntimeCheck !== true) {
    assertBuiltRuntime(plan, dependencies);
  }
  await prepareOutputDirectory(plan, dependencies);

  const state: SupervisorRunState = {
    classifications: [],
    artifacts: [],
    preflightState: [],
    txCount: 0,
    latestPublicState: undefined,
  };

  const stopForUnavailableWallClockBudget: StopForUnavailableWallClockBudget = async (
    incidentCycleIndex,
    stage,
    remainingWallClockMs,
  ) =>
    stopForWallClockBudget(
      args,
      plan,
      state,
      wallClockDeadline,
      dependencies,
      incidentCycleIndex,
      stage,
      remainingWallClockMs,
    );

  for (let cycleIndex = 1; cycleIndex <= args.maxCycles; cycleIndex += 1) {
    const stop = await runSupervisorCycle(
      cycleIndex,
      args,
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

  const pendingAuditStop = await stopForPendingBotBalanceAudit(
    args.maxCycles,
    plan,
    state,
    dependencies,
  );
  if (pendingAuditStop !== undefined) {
    return pendingAuditStop;
  }

  await writeSummary(plan, state, "max_cycles", dependencies);
  return 0;
}
