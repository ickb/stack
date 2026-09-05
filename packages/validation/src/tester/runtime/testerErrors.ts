import {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
  recordExecutionError,
} from "@ickb/node-utils";
import { TransactionBroadcastError } from "@ickb/sdk";
import { createExecutionLogWriter, type ExecutionLog } from "./testerTypes.ts";

/**
 * Records the failure and exits 1 so the operator or service manager runs another turn.
 */
export function handleTesterAttemptError(
  error: unknown,
  executionLog: ExecutionLog,
): void {
  if (isRetryableTesterError(error)) {
    createExecutionLogWriter(executionLog).record({
      error: {
        message: "Retryable tester error",
        error: retryableTesterErrorEvidence(error),
        retryable: true,
      },
    });
  } else {
    recordExecutionError(executionLog, error);
  }
  process.exitCode = 1;
}

/**
 * Identifies transient tester failures worth another turn.
 */
export function isRetryableTesterError(error: unknown): boolean {
  if (
    error instanceof TransactionBroadcastError ||
    (error instanceof Error && error.name === "TransactionConfirmationError")
  ) {
    return false;
  }
  return (
    isRetryableCkbStateRaceError(error) ||
    isRetryableRpcResponseShapeError(error) ||
    isRetryableRpcTransportError(error)
  );
}

// BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
// - OWNER: tester retryable failure logging boundary.
// - INVARIANT: private keys stay outside failure fields; public chain and RPC retry evidence may be logged.
// - FAILURE MODE: redacting, masking, or scanning here makes secret-bearing logger inputs look acceptable instead of fixing the producer.
function retryableTesterErrorEvidence(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...("code" in error && typeof error.code === "number" ? { code: error.code } : {}),
      ...("data" in error && typeof error.data === "string" ? { data: error.data } : {}),
      ...("txHash" in error && typeof error.txHash === "string"
        ? { txHash: error.txHash }
        : {}),
    };
  }
  return { message: "Retryable tester error" };
}
