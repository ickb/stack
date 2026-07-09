import {
  handleLoopError,
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
  STOP_EXIT_CODE,
  type RuntimeConfig,
} from "@ickb/node-utils";
import { errorSummary } from "../observability/error.ts";
import { isRbfRejectedReason } from "../observability/rbf.ts";

interface TransactionConfirmationErrorLike extends Error {
  status: unknown;
  isTimeout: unknown;
  reason: unknown;
}

export interface FailureHandlingResult {
  retryableAttempt: boolean;
  retryableAttempts: number;
  stopAfterLog: boolean;
}

interface IterationFailureFields extends Record<string, unknown> {
  error: Record<string, unknown> | string;
  retryable: boolean;
  terminal: boolean;
  retryBudgetExhausted?: boolean;
}

interface FailureHandlingContext {
  events: {
    emit: (
      iterationId: number,
      type: "bot.iteration.failed",
      fields?: Record<string, unknown>,
    ) => unknown;
  };
  maxRetryableAttempts: RuntimeConfig["maxRetryableAttempts"];
}

export function handleIterationFailure({
  context,
  iterationId,
  executionLog,
  error,
  retryableAttempts,
}: {
  context: FailureHandlingContext;
  iterationId: number;
  executionLog: Record<string, unknown>;
  error: unknown;
  retryableAttempts: number;
}): FailureHandlingResult {
  const retryable = isRetryableBotError(error);
  const nextRetryableAttempts = retryable ? retryableAttempts + 1 : retryableAttempts;
  const failure = retryable
    ? iterationFailureEventFields(error, {
        retryableAttempts: nextRetryableAttempts,
        maxRetryableAttempts: context.maxRetryableAttempts,
      })
    : iterationFailureEventFields(error);
  context.events.emit(iterationId, "bot.iteration.failed", failure);
  return failure.retryable
    ? handleRetryableFailure(
        executionLog,
        failure,
        nextRetryableAttempts,
        context.maxRetryableAttempts,
      )
    : handleNonRetryableFailure(executionLog, error, failure, nextRetryableAttempts);
}

/**
 * Builds public failure fields for bot loop events.
 */
export function iterationFailureEventFields(error: unknown): {
  error: Record<string, unknown> | string;
  retryable: boolean;
  terminal: boolean;
  retryableAttempts?: number;
  maxRetryableAttempts?: number;
  retryBudgetExhausted?: boolean;
};
export function iterationFailureEventFields(
  error: unknown,
  retryBudget: {
    retryableAttempts: number;
    maxRetryableAttempts: number | undefined;
  },
): {
  error: Record<string, unknown> | string;
  retryable: boolean;
  terminal: boolean;
  retryableAttempts: number;
  maxRetryableAttempts?: number;
  retryBudgetExhausted: boolean;
};
export function iterationFailureEventFields(
  error: unknown,
  retryBudget?: {
    retryableAttempts: number;
    maxRetryableAttempts: number | undefined;
  },
): {
  error: Record<string, unknown> | string;
  retryable: boolean;
  terminal: boolean;
  retryableAttempts?: number;
  maxRetryableAttempts?: number;
  retryBudgetExhausted?: boolean;
} {
  const retryable = isRetryableBotError(error);
  const retryBudgetExhausted =
    retryable &&
    retryBudget !== undefined &&
    reachedMaxRetryableAttempts(
      retryBudget.retryableAttempts,
      retryBudget.maxRetryableAttempts,
    );
  return {
    error: errorSummary(error, { includeStack: !retryable }),
    retryable,
    terminal: !retryable || retryBudgetExhausted,
    ...(retryBudget === undefined
      ? {}
      : {
          retryableAttempts: retryBudget.retryableAttempts,
          ...(retryBudget.maxRetryableAttempts === undefined
            ? {}
            : { maxRetryableAttempts: retryBudget.maxRetryableAttempts }),
          retryBudgetExhausted,
        }),
  };
}

function handleRetryableFailure(
  executionLog: Record<string, unknown>,
  failure: IterationFailureFields,
  retryableAttempts: number,
  maxRetryableAttempts: RuntimeConfig["maxRetryableAttempts"],
): FailureHandlingResult {
  Object.assign(executionLog, { error: failure.error });
  if (failure.retryBudgetExhausted === true) {
    Object.assign(executionLog, {
      error: {
        message: "Retryable bot error budget exhausted",
        attempts: retryableAttempts,
        maxRetryableAttempts,
        lastError: failure.error,
      },
    });
    process.exitCode = STOP_EXIT_CODE;
    return { retryableAttempt: true, retryableAttempts, stopAfterLog: true };
  }
  return { retryableAttempt: true, retryableAttempts, stopAfterLog: false };
}

function handleNonRetryableFailure(
  executionLog: Record<string, unknown>,
  error: unknown,
  failure: IterationFailureFields,
  retryableAttempts: number,
): FailureHandlingResult {
  let stopAfterLog = handleLoopError(executionLog, error);
  const exitCode = nonRetryableTerminalFailureExitCode(failure);
  if (!stopAfterLog && exitCode !== undefined) {
    process.exitCode = exitCode;
    stopAfterLog = true;
  }
  return { retryableAttempt: false, retryableAttempts, stopAfterLog };
}

/**
 * Maps a terminal non-retryable failure to the process failure exit code.
 */
export function nonRetryableTerminalFailureExitCode(failure: {
  retryable: boolean;
  terminal: boolean;
}): 1 | undefined {
  return !failure.retryable && failure.terminal ? 1 : undefined;
}

/**
 * Reports whether retryable failures have consumed the configured retry budget.
 */
export function reachedMaxRetryableAttempts(
  retryableAttempts: number,
  maxRetryableAttempts: number | undefined,
): boolean {
  return maxRetryableAttempts !== undefined && retryableAttempts >= maxRetryableAttempts;
}

/**
 * Identifies transient bot failures that can be retried without consuming a terminal iteration.
 */
export function isRetryableBotError(error: unknown): boolean {
  return (
    (error instanceof Error &&
      (error.message === "L1 state scan crossed chain tip; retry with a fresh state" ||
        isRetryableRpcResponseShapeError(error) ||
        isRetryableRpcTransportError(error) ||
        isRetryableRbfConfirmationError(error))) ||
    isRetryableCkbStateRaceError(error)
  );
}

function isRetryableRbfConfirmationError(error: Error): boolean {
  return (
    isTransactionConfirmationErrorLike(error) &&
    error.status === "rejected" &&
    error.isTimeout === false &&
    typeof error.reason === "string" &&
    isRbfRejectedReason(error.reason)
  );
}

function isTransactionConfirmationErrorLike(
  error: Error,
): error is TransactionConfirmationErrorLike {
  return (
    error.name === "TransactionConfirmationError" &&
    "status" in error &&
    "isTimeout" in error &&
    "reason" in error
  );
}
