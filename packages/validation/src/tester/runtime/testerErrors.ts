import {
  handleLoopError,
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
  logExecution,
  STOP_EXIT_CODE,
} from "@ickb/node-utils";
import { TransactionBroadcastError } from "@ickb/sdk";
import { MissingFreshOrderOriginError } from "./freshMatchableOrderSkip.ts";
import {
  createExecutionLogWriter,
  TesterTerminalError,
  type ExecutionLog,
} from "./testerTypes.ts";

type TesterAttemptResult = "completed" | "retry" | "stop";

type HandleTesterAttemptErrorParameters = [
  error: unknown,
  executionLog: ExecutionLog,
  startTime: Date,
  retryableAttempts: number,
  maxRetryableAttempts: number | undefined,
];
export function handleTesterAttemptError(
  ...[
    error,
    executionLog,
    startTime,
    retryableAttempts,
    maxRetryableAttempts,
  ]: HandleTesterAttemptErrorParameters
): { result: TesterAttemptResult; retryableAttempts: number } {
  if (isRetryableTesterError(error)) {
    const nextRetryableAttempts = retryableAttempts + 1;
    const failure = testerRetryableFailureFields(
      error,
      nextRetryableAttempts,
      maxRetryableAttempts,
    );
    createExecutionLogWriter(executionLog).record({ error: failure });
    if (failure.retryBudgetExhausted) {
      process.exitCode = STOP_EXIT_CODE;
      logExecution(executionLog, startTime);
      return { result: "stop", retryableAttempts: nextRetryableAttempts };
    }
    logExecution(executionLog, startTime);
    return { result: "retry", retryableAttempts: nextRetryableAttempts };
  }
  const stopAfterLog = handleLoopError(executionLog, error);
  if (isTerminalTesterError(error)) {
    process.exitCode = 1;
    logExecution(executionLog, startTime);
    return { result: "stop", retryableAttempts };
  }
  if (!stopAfterLog) {
    process.exitCode = 1;
  }
  logExecution(executionLog, startTime);
  return { result: "stop", retryableAttempts };
}
/**
 * Identifies transient tester failures that can be retried without consuming an iteration.
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
/**
 * Identifies tester failures that should stop the loop without retrying.
 */
export function isTerminalTesterError(error: unknown): boolean {
  return (
    error instanceof TesterTerminalError || error instanceof MissingFreshOrderOriginError
  );
}
/**
 * Builds JSON-safe retry evidence for tester loop logs.
 */
export function testerRetryableFailureFields(
  error: unknown,
  retryableAttempts: number,
  maxRetryableAttempts: number | undefined,
): {
  message: string;
  error: Record<string, unknown> | string;
  retryable: true;
  terminal: boolean;
  retryableAttempts: number;
  maxRetryableAttempts?: number;
  retryBudgetExhausted: boolean;
} {
  const retryBudgetExhausted =
    maxRetryableAttempts !== undefined && retryableAttempts >= maxRetryableAttempts;
  return {
    message: retryBudgetExhausted
      ? "Retryable tester error budget exhausted"
      : "Retryable tester error",
    error: retryableTesterErrorEvidence(error),
    retryable: true,
    terminal: retryBudgetExhausted,
    retryableAttempts,
    ...(maxRetryableAttempts === undefined ? {} : { maxRetryableAttempts }),
    retryBudgetExhausted,
  };
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
