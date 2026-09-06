import type { ExecutionLog } from "./testerTypes.ts";

/**
 * Records the failure and exits 1 so the operator or service manager runs another turn.
 */
export function handleTesterAttemptError(
  error: unknown,
  executionLog: ExecutionLog,
): void {
  const log = executionLog;
  log.error = error;
  process.exitCode = 1;
}
