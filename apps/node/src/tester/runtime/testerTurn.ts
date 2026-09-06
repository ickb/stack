import { logExecution } from "../../shared/index.ts";
import type { Runtime } from "./runtime.ts";
import { runTesterAttempt } from "./testerAttempt.ts";
import { handleTesterAttemptError } from "./testerErrors.ts";
import type {
  ExecutionLog,
  TesterFeePolicy,
  TesterIdentity,
  TesterScenarioSelection,
} from "./testerTypes.ts";

/** Runs one tester attempt, writes its execution log line, and leaves the exit code set. */
export async function runTesterTurn({
  runtime,
  identity,
  testerScenario,
  feePolicy,
}: {
  runtime: Runtime;
  identity: TesterIdentity;
  testerScenario: TesterScenarioSelection;
  feePolicy: TesterFeePolicy;
}): Promise<void> {
  const startTime = new Date();
  // Identity leads the record: who acted, where, and through which endpoint.
  const executionLog: ExecutionLog = { identity, startTime: startTime.toLocaleString() };
  try {
    await runTesterAttempt({ runtime, testerScenario, feePolicy, executionLog });
  } catch (error) {
    handleTesterAttemptError(error, executionLog);
  }
  logExecution(executionLog, startTime);
}
