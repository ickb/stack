import { logExecution } from "@ickb/node-utils";
import type { Runtime } from "./runtime.ts";
import { runTesterAttempt } from "./testerAttempt.ts";
import { handleTesterAttemptError } from "./testerErrors.ts";
import {
  createExecutionLogWriter,
  type ExecutionLog,
  type TesterFeePolicy,
  type TesterScenarioSelection,
} from "./testerTypes.ts";

/** Runs one tester attempt, writes its execution log line, and leaves the exit code set. */
export async function runTesterTurn({
  runtime,
  testerScenario,
  feePolicy,
}: {
  runtime: Runtime;
  testerScenario: TesterScenarioSelection;
  feePolicy: TesterFeePolicy;
}): Promise<void> {
  const executionLog: ExecutionLog = {};
  const startTime = new Date();
  createExecutionLogWriter(executionLog).record({
    startTime: startTime.toLocaleString(),
  });
  try {
    await runTesterAttempt({ runtime, testerScenario, feePolicy, executionLog });
  } catch (error) {
    handleTesterAttemptError(error, executionLog);
  }
  logExecution(executionLog, startTime);
}
