import {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
} from "../../shared/index.ts";
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
 * Emits the failure event and exits 1 so the service manager starts another turn. Every
 * failure is safe to follow with a fresh turn: it rebuilds from committed state, and a
 * transaction still pending from this turn conflicts with the rebuilt one at the node.
 */
export function handleTurnFailure(events: FailureEvents, error: unknown): void {
  const retryable = isRetryableBotError(error);
  events.emit("bot.turn.failed", {
    error: errorSummary(error, { includeStack: !retryable }),
    retryable,
    terminal: !retryable,
  });
  process.exitCode = 1;
}

/**
 * Classifies transient bot failures for the failure events; it no longer decides the exit code.
 */
export function isRetryableBotError(error: unknown): boolean {
  if (error instanceof Error && isTransactionConfirmationErrorLike(error)) {
    // Only an RBF replacement proves the sent transaction can never confirm; every
    // other confirmation failure leaves its outcome unknown and is reported as such.
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
