import { writeSummary } from "../../artifacts/supervisorArtifacts.ts";
import { runSupervisorCycle } from "../actor/supervisorCycleRun.ts";
import {
  assertBuiltRuntime,
  now,
  prepareOutputDirectory,
} from "../command/supervisorCommandRun.ts";
import { runDryRun } from "../dry-run/supervisorDryRun.ts";
import { DEFAULT_COVERAGE_GOALS } from "./supervisorConstants.ts";
import { createCoverageLedger, explicitCoverageGoals } from "./supervisorCoverage.ts";
import {
  stopForPendingBotBalanceAudit,
  stopForUnmetGoals,
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
  if (!args.dryRun && dependencies.skipBuiltRuntimeCheck !== true) {
    assertBuiltRuntime(plan, dependencies);
  }
  await prepareOutputDirectory(plan, dependencies);

  const explicitGoals = explicitCoverageGoals(args);
  const goals = explicitGoals.length > 0 ? explicitGoals : DEFAULT_COVERAGE_GOALS;
  if (args.dryRun) {
    return runDryRun(args, plan, createCoverageLedger(goals), dependencies);
  }

  const state = initialRunState(goals);

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

  const unmetStop = await stopForUnmetGoals(args, plan, state, dependencies);
  if (unmetStop !== undefined) {
    return unmetStop;
  }

  await writeSummary(
    plan,
    state.ledger,
    state.classifications,
    state.artifacts,
    state.preflightState,
    state.latestPublicState,
    "max_cycles",
    dependencies,
  );
  return 0;
}

function initialRunState(
  goals: SupervisorRunState["ledger"]["goals"],
): SupervisorRunState {
  return {
    ledger: createCoverageLedger(goals),
    classifications: [],
    artifacts: [],
    preflightState: [],
    txCount: 0,
    latestPublicState: undefined,
  };
}
