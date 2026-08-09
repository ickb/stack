import {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
  STOP_EXIT_CODE,
  type RuntimeConfig,
} from "@ickb/node-utils";
import { TransactionBroadcastError } from "@ickb/sdk";
import { errorSummary } from "../observability/error.ts";
import { isRbfRejectedReason } from "../observability/rbf.ts";

interface TransactionConfirmationErrorLike extends Error {
  status: unknown;
  isTimeout: unknown;
  reason: unknown;
  rebuildReady: unknown;
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
  error,
  retryableAttempts,
}: {
  context: FailureHandlingContext;
  iterationId: number;
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
  if (failure.retryable) {
    return handleRetryableFailure(failure, nextRetryableAttempts);
  }
  return handleNonRetryableFailure(nextRetryableAttempts);
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
  failure: IterationFailureFields,
  retryableAttempts: number,
): FailureHandlingResult {
  if (failure.retryBudgetExhausted === true) {
    process.exitCode = STOP_EXIT_CODE;
    return { retryableAttempt: true, retryableAttempts, stopAfterLog: true };
  }
  return { retryableAttempt: true, retryableAttempts, stopAfterLog: false };
}

function handleNonRetryableFailure(retryableAttempts: number): FailureHandlingResult {
  process.exitCode = 1;
  return {
    retryableAttempt: false,
    retryableAttempts,
    stopAfterLog: true,
  };
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
  if (
    isBlockedRejectedConfirmation(error) ||
    (error instanceof TransactionBroadcastError && error.nodeTxHash !== undefined)
  ) {
    return false;
  }
  let current = error;
  const seen = new Set<object>();
  while (isUnseenObject(current, seen)) {
    seen.add(current);
    if (isRetryableErrorLevel(current)) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

function isUnseenObject(error: unknown, seen: ReadonlySet<object>): error is object {
  return typeof error === "object" && error !== null && !seen.has(error);
}

function isRetryableErrorLevel(error: object): boolean {
  if (isRetryableCkbStateRaceError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  return [
    isRetryableConfirmationTimeout,
    isRetryableRpcResponseShapeError,
    isRetryableRpcTransportError,
    isRetryableRbfConfirmationError,
  ].some((classify) => classify(error));
}

function isRetryableConfirmationTimeout(error: Error): boolean {
  return (
    error.name === "BotTransactionConfirmationError" &&
    "isTimeout" in error &&
    error.isTimeout === true
  );
}

function isRetryableRbfConfirmationError(error: Error): boolean {
  return (
    isTransactionConfirmationErrorLike(error) &&
    error.status === "rejected" &&
    error.isTimeout === false &&
    error.rebuildReady === true &&
    typeof error.reason === "string" &&
    isRbfRejectedReason(error.reason)
  );
}

function isBlockedRejectedConfirmation(error: unknown): boolean {
  return (
    error instanceof Error &&
    isTransactionConfirmationErrorLike(error) &&
    error.status === "rejected" &&
    error.rebuildReady !== true
  );
}

function isTransactionConfirmationErrorLike(
  error: Error,
): error is TransactionConfirmationErrorLike {
  return (
    (error.name === "TransactionConfirmationError" ||
      error.name === "BotTransactionConfirmationError") &&
    "status" in error &&
    "isTimeout" in error &&
    "reason" in error &&
    "rebuildReady" in error
  );
}
