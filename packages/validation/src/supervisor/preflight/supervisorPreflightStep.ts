import process from "node:process";
import { assertNoSymlinkedConfigPath } from "../args/supervisorPaths.ts";
import { liveActorEnv } from "../classification/supervisorClassifyUtils.ts";
import { runCommand } from "../runtime/command/supervisorCommandRun.ts";
import type { Actor, OutcomeKind } from "../runtime/shared/supervisorConstants.ts";
import type {
  CommandResult,
  Dependencies,
  ScenarioStep,
  StopForUnavailableWallClockBudget,
  SupervisorPlan,
} from "../runtime/shared/supervisorTypes.ts";
import { commandTimeoutDecision } from "./supervisorPreflightBudget.ts";

/**
 * Chooses the per-command timeout or converts exhausted wall-clock budget into a stop.
 */
export async function commandTimeoutOrStop(
  ...[
    plan,
    wallClockDeadline,
    dependencies,
    cycleIndex,
    stage,
    stopForUnavailableWallClockBudget,
  ]: [
    plan: SupervisorPlan,
    wallClockDeadline: number | undefined,
    dependencies: Dependencies,
    cycleIndex: number,
    stage: string,
    stopForUnavailableWallClockBudget: StopForUnavailableWallClockBudget,
  ]
): Promise<{ timeoutMs: number } | { stop: number }> {
  const decision = commandTimeoutDecision(plan, wallClockDeadline, dependencies);
  if ("timeoutMs" in decision) {
    return decision;
  }
  const stop = await stopForUnavailableWallClockBudget(
    cycleIndex,
    stage,
    decision.remainingWallClockMs,
  );
  if (stop === undefined) {
    throw new Error("Wall-clock stop evidence was not finalized");
  }
  return { stop };
}

export async function runPreflight(
  ...[actor, plan, dependencies, timeoutMs]: [
    actor: Actor,
    plan: SupervisorPlan,
    dependencies: Dependencies,
    timeoutMs: number,
  ]
): Promise<CommandResult> {
  const configPath = actor === "bot" ? plan.botConfigPath : plan.testerConfigPath;
  await assertNoSymlinkedConfigPath(plan.rootDir, configPath, `${actor} config path`);
  return runCommand(
    {
      actor: "preflight",
      command: process.execPath,
      args: ["scripts/live/preflight.ts", "--config", configPath],
      cwd: plan.rootDir,
      env: liveActorEnv({ INIT_CWD: plan.rootDir }),
      timeoutMs,
    },
    dependencies,
  );
}

export function preflightNonzeroOutcome(stderr: string): OutcomeKind {
  if (
    (stderr.includes("Invalid") && stderr.includes("chain identity")) ||
    (stderr.includes("Missing") && stderr.includes("genesis header"))
  ) {
    return "wrong_chain";
  }
  if (stderr.includes("Live preflight retryable failure:")) {
    return "preflight_retryable_error";
  }
  return "nonzero_exit";
}

export function stepLabel(step: ScenarioStep): string {
  return step.label ?? step.actor;
}
