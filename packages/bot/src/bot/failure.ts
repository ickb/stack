import {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
  isUnresolvedBroadcast,
  STOP_EXIT_CODE,
} from "@ickb/node-utils";
import { TransactionBroadcastError } from "@ickb/sdk";
import { errorSummary } from "../observability/error.ts";
import { isRbfRejectedReason } from "../observability/rbf.ts";

interface TransactionConfirmationErrorLike extends Error {
  status: unknown;
  isTimeout: unknown;
  reason: unknown;
}

interface FailureEvents {
  emit: (type: "bot.turn.failed", fields?: Record<string, unknown>) => unknown;
}

/**
 * Emits the failure event and sets the exit code that tells the service manager what to do:
 * 1 lets it start another turn, STOP_EXIT_CODE holds it because a broadcast outcome is unresolved.
 */
export function handleTurnFailure(events: FailureEvents, error: unknown): void {
  const retryable = isRetryableBotError(error);
  events.emit("bot.turn.failed", {
    error: errorSummary(error, { includeStack: !retryable }),
    retryable,
    terminal: !retryable,
  });
  process.exitCode = retryable || !isUnresolvedBroadcast(error) ? 1 : STOP_EXIT_CODE;
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
