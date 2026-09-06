import { STOP_EXIT_CODE } from "../../../shared/index.ts";
import { createExecutionLogWriter, type ExecutionLog } from "./testerTypes.ts";

/**
 * Records a low-capital shutdown and sets the stop exit code so no further turn is started.
 */
export function stopForLowTesterCapital(executionLog: ExecutionLog): void {
  createExecutionLogWriter(executionLog).record({
    error: "Not enough funds to continue testing, shutting down...",
  });
  process.exitCode = STOP_EXIT_CODE;
}
