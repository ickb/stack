import { logExecution, STOP_EXIT_CODE } from "@ickb/node-utils";
import { createExecutionLogWriter, type ExecutionLog } from "./testerTypes.ts";

/**
 * Records a low-capital shutdown and sets the tester stop exit code.
 */
export function stopForLowTesterCapital(
  executionLog: ExecutionLog,
  startTime: Date,
): void {
  createExecutionLogWriter(executionLog).record({
    error: "Not enough funds to continue testing, shutting down...",
  });
  process.exitCode = STOP_EXIT_CODE;
  logExecution(executionLog, startTime);
}
