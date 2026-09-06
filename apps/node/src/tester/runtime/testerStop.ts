import { STOP_EXIT_CODE } from "../../shared/index.ts";
import type { ExecutionLog } from "./testerTypes.ts";

/**
 * Records a low-capital shutdown and sets the stop exit code so no further turn is started.
 */
export function stopForLowTesterCapital(executionLog: ExecutionLog): void {
  const log = executionLog;
  log.error = "Not enough funds to continue testing, shutting down...";
  process.exitCode = STOP_EXIT_CODE;
}
