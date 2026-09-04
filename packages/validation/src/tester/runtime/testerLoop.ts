import {
  logExecution,
  randomSleepIntervalMs,
  reachedMaxIterations,
  sleep,
} from "@ickb/node-utils";
import type { Runtime } from "./runtime.ts";
import { runTesterAttempt, type TesterAttemptResult } from "./testerAttempt.ts";
import { handleTesterAttemptError } from "./testerErrors.ts";
import {
  createExecutionLogWriter,
  type ExecutionLog,
  type TesterFeePolicy,
  type TesterScenarioSelection,
} from "./testerTypes.ts";

/** Runs tester attempts until stopped by config, terminal error, or process exit. */
export async function runTesterLoop({
  runtime,
  testerScenario,
  feePolicy,
  sleepIntervalMs,
  maxIterations,
  maxRetryableAttempts,
}: {
  runtime: Runtime;
  testerScenario: TesterScenarioSelection;
  feePolicy: TesterFeePolicy;
  sleepIntervalMs: number;
  maxIterations: number | undefined;
  maxRetryableAttempts: number | undefined;
}): Promise<void> {
  let startedAttempts = 0;
  let loopState = {
    completedIterations: 0,
    retryableAttempts: 0,
  };
  for (;;) {
    if (shouldSleepBeforeTesterAttempt(startedAttempts)) {
      await sleep(randomSleepIntervalMs(sleepIntervalMs));
    }
    startedAttempts += 1;
    const executionLog: ExecutionLog = {};
    const startTime = new Date();
    createExecutionLogWriter(executionLog).record({
      startTime: startTime.toLocaleString(),
    });
    try {
      const result = await runTesterAttempt({
        runtime,
        testerScenario,
        feePolicy,
        executionLog,
        startTime,
      });
      const finished = finishTesterAttempt({
        result,
        executionLog,
        startTime,
        loopState,
        maxIterations,
      });
      loopState = finished.loopState;
      if (finished.action === "stop") {
        return;
      }
    } catch (error) {
      const failure = handleTesterAttemptError(
        error,
        executionLog,
        startTime,
        loopState.retryableAttempts,
        maxRetryableAttempts,
      );
      const finished = finishTesterAttempt({
        result: failure.result,
        executionLog,
        startTime,
        loopState: { ...loopState, retryableAttempts: failure.retryableAttempts },
        maxIterations,
      });
      loopState = finished.loopState;
      if (finished.action === "stop") {
        return;
      }
    }
  }
}

type TesterLoopAction = "continue" | "stop";

interface FinishedTesterAttempt {
  action: TesterLoopAction;
  loopState: TesterLoopState;
}

interface TesterLoopState {
  completedIterations: number;
  retryableAttempts: number;
}
function finishTesterAttempt({
  result,
  executionLog,
  startTime,
  loopState,
  maxIterations,
}: {
  result: TesterAttemptResult;
  executionLog: ExecutionLog;
  startTime: Date;
  loopState: TesterLoopState;
  maxIterations: number | undefined;
}): FinishedTesterAttempt {
  if (result === "stop") {
    return { action: "stop", loopState };
  }
  if (result === "retry") {
    return { action: "continue", loopState };
  }
  const nextLoopState = {
    completedIterations: loopState.completedIterations + 1,
    retryableAttempts: 0,
  };
  const action = logTerminalIteration(
    executionLog,
    startTime,
    nextLoopState.completedIterations,
    maxIterations,
  )
    ? "stop"
    : "continue";
  return { action, loopState: nextLoopState };
}
/**
 * Skips the first tester sleep so a fresh process attempts one action immediately.
 */
export function shouldSleepBeforeTesterAttempt(startedAttempts: number): boolean {
  return startedAttempts > 0;
}
function logTerminalIteration(
  executionLog: Record<string, unknown>,
  startTime: Date,
  completedIterations: number,
  maxIterations: number | undefined,
): boolean {
  logExecution(executionLog, startTime);
  return reachedMaxIterations(completedIterations, maxIterations);
}
