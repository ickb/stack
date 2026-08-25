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
  return handleNonRetryableFailure(error, nextRetryableAttempts);
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

function handleNonRetryableFailure(
  error: unknown,
  retryableAttempts: number,
): FailureHandlingResult {
  // The transaction may already be accepted and its outcome stayed unresolved,
  // so a restart could resend funds: stop the service instead of letting the
  // supervisor relaunch the turn. A node hash mismatch is such an outcome, since
  // the node answered the send RPC about a transaction this attempt cannot bind.
  process.exitCode =
    (error instanceof TransactionBroadcastError && error.nodeTxHash !== undefined) ||
    (error instanceof Error && isTransactionConfirmationErrorLike(error))
      ? STOP_EXIT_CODE
      : 1;
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
  if (error instanceof TransactionBroadcastError && error.nodeTxHash !== undefined) {
    return false;
  }
  if (error instanceof Error && isTransactionConfirmationErrorLike(error)) {
    // The transaction is already broadcast, so no confirmation outcome may send
    // a rebuilt intent: one broadcast gets one finite observation window. Only
    // an RBF replacement makes the sent transaction permanently unconfirmable,
    // so only it is worth rebuilding from committed state.
    return isRbfRejectedConfirmation(error);
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
  return [isRetryableRpcResponseShapeError, isRetryableRpcTransportError].some(
    (classify) => classify(error),
  );
}

function isRbfRejectedConfirmation(error: TransactionConfirmationErrorLike): boolean {
  return (
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
    (error.name === "TransactionConfirmationError" ||
      error.name === "BotTransactionConfirmationError") &&
    "status" in error &&
    "isTimeout" in error &&
    "reason" in error
  );
}
