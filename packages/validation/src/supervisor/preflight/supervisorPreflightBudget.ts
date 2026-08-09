import { now } from "../runtime/command/supervisorCommandRun.ts";
import {
  COMMAND_START_GRACE_MS,
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
} from "../runtime/shared/supervisorConstants.ts";
import type {
  Dependencies,
  ParsedArgs,
  StopDiagnostics,
  SupervisorPlan,
} from "../runtime/shared/supervisorTypes.ts";

export function commandTimeoutDecision(
  plan: SupervisorPlan,
  wallClockDeadline: number | undefined,
  dependencies: Dependencies,
): { timeoutMs: number } | { remainingWallClockMs: number } {
  const configuredTimeoutMs = plan.commandTimeoutSeconds * 1000;
  const remainingMs = remainingWallClockMs(wallClockDeadline, dependencies);
  if (remainingMs === undefined) {
    return { timeoutMs: configuredTimeoutMs };
  }
  if (!hasWallClockCommandBudgetForRemaining(plan, remainingMs)) {
    return { remainingWallClockMs: remainingMs };
  }
  return { timeoutMs: Math.min(configuredTimeoutMs, remainingMs) };
}

export function wallClockBudgetStopDiagnostics(
  ...[
    args,
    plan,
    wallClockDeadline,
    dependencies,
    cycleIndex,
    stage,
    observedRemainingWallClockMs,
  ]: [
    args: ParsedArgs,
    plan: SupervisorPlan,
    wallClockDeadline: number | undefined,
    dependencies: Dependencies,
    cycleIndex: number,
    stage: string,
    observedRemainingWallClockMs?: number,
  ]
): StopDiagnostics | undefined {
  if (args.maxWallClockSeconds === undefined) {
    return undefined;
  }
  const remainingMs =
    observedRemainingWallClockMs ?? remainingWallClockMs(wallClockDeadline, dependencies);
  if (
    remainingMs === undefined ||
    hasWallClockCommandBudgetForRemaining(plan, remainingMs)
  ) {
    return undefined;
  }
  const minimumBudgetMs = minimumCommandStartBudgetMs(plan);
  const graceMs = commandStartGraceMs(plan);
  return {
    reason: "insufficient_wall_clock_command_budget",
    cycleIndex,
    stage,
    remainingWallClockMs: remainingMs,
    requiredCommandStartBudgetMs: minimumBudgetMs - graceMs,
    configuredCommandTimeoutMs: plan.commandTimeoutSeconds * 1000,
    commandStartGraceMs: graceMs,
    maxWallClockSeconds: args.maxWallClockSeconds,
  };
}

function remainingWallClockMs(
  wallClockDeadline: number | undefined,
  dependencies: Dependencies,
): number | undefined {
  return wallClockDeadline === undefined
    ? undefined
    : wallClockDeadline - now(dependencies);
}

function hasWallClockCommandBudgetForRemaining(
  plan: SupervisorPlan,
  remainingMs: number,
): boolean {
  const requiredMs = minimumCommandStartBudgetMs(plan) - commandStartGraceMs(plan);
  return remainingMs >= requiredMs;
}

function commandStartGraceMs(plan: SupervisorPlan): number {
  return Math.min(
    COMMAND_START_GRACE_MS,
    Math.floor(minimumCommandStartBudgetMs(plan) / 10),
  );
}

function minimumCommandStartBudgetMs(plan: SupervisorPlan): number {
  return Math.min(
    plan.commandTimeoutSeconds * 1000,
    DEFAULT_COMMAND_TIMEOUT_SECONDS * 1000,
  );
}
