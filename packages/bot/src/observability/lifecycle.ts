import type { ccc } from "@ckb-ccc/core";
import type { SendAndWaitForCommitEvent } from "@ickb/sdk";
import { errorSummary } from "./error.ts";
import { isRbfRejectedReason } from "./rbf.ts";

const BOT_TRANSACTION_CONFIRMATION = "bot.transaction.confirmation";
const BOT_TRANSACTION_FAILED = "bot.transaction.failed";

interface TransactionLifecycleRecord {
  type:
    | "bot.transaction.sent"
    | "bot.transaction.confirmation"
    | "bot.transaction.committed"
    | "bot.transaction.failed";
  fields: Record<string, unknown>;
}

type ConfirmationLifecycleEvent = Extract<
  SendAndWaitForCommitEvent,
  { txHash: ccc.Hex; checks: number }
>;

/**
 * Converts SDK transaction lifecycle events into bot event records.
 */
export function transactionLifecycleEvents(
  event: SendAndWaitForCommitEvent,
  isRetryableError: (error: unknown) => boolean = (): boolean => false,
): TransactionLifecycleRecord[] {
  switch (event.type) {
    case "broadcasted":
      return [broadcastedLifecycleEvent(event)];
    case "committed":
      return committedLifecycleEvents(event);
    case "timeout_after_broadcast":
    case "post_broadcast_unresolved":
      return terminalFailureLifecycleEvents(event, event.type);
    case "terminal_rejection":
      return terminalFailureLifecycleEvents(event, "terminal_rejection");
    case "pre_broadcast_failed":
      return [preBroadcastFailedLifecycleEvent(event, isRetryableError)];
  }
}

function broadcastedLifecycleEvent(
  event: Extract<SendAndWaitForCommitEvent, { type: "broadcasted" }>,
): TransactionLifecycleRecord {
  return {
    type: "bot.transaction.sent",
    fields: {
      txHash: event.txHash,
      phase: "broadcast",
      outcome: "broadcasted",
      elapsedMs: event.elapsedMs,
    },
  };
}

function committedLifecycleEvents(
  event: ConfirmationLifecycleEvent,
): TransactionLifecycleRecord[] {
  return [
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: terminalConfirmationFields(event, "committed"),
    },
    {
      type: "bot.transaction.committed",
      fields: { ...confirmationFields(event), outcome: "committed" },
    },
  ];
}

function terminalFailureLifecycleEvents(
  event: ConfirmationLifecycleEvent,
  outcome: string,
): TransactionLifecycleRecord[] {
  return [
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: terminalConfirmationFields(event, outcome),
    },
    {
      type: BOT_TRANSACTION_FAILED,
      fields: terminalConfirmationFields(event, outcome),
    },
  ];
}

function preBroadcastFailedLifecycleEvent(
  event: Extract<SendAndWaitForCommitEvent, { type: "pre_broadcast_failed" }>,
  isRetryableError: (error: unknown) => boolean,
): TransactionLifecycleRecord {
  const retryable = isRetryableError(event.error);
  return {
    type: BOT_TRANSACTION_FAILED,
    fields: {
      phase: "pre_broadcast",
      outcome: "pre_broadcast_failed",
      elapsedMs: event.elapsedMs,
      error: errorSummary(event.error, { includeStack: !retryable }),
      retryable,
      terminal: !retryable,
    },
  };
}

function terminalConfirmationFields(
  event: ConfirmationLifecycleEvent,
  outcome: string,
): Record<string, unknown> {
  const retryable = isRbfRejectedConfirmation(event);
  return {
    ...confirmationFields(event),
    outcome,
    retryable,
    terminal: !retryable,
  };
}

function isRbfRejectedConfirmation(event: ConfirmationLifecycleEvent): boolean {
  return (
    event.status === "rejected" &&
    "reason" in event &&
    typeof event.reason === "string" &&
    isRbfRejectedReason(event.reason)
  );
}

function confirmationFields(
  event: Extract<SendAndWaitForCommitEvent, { txHash: ccc.Hex; checks: number }>,
): Record<string, unknown> {
  return {
    phase: "confirmation",
    txHash: event.txHash,
    status: event.status,
    ...("reason" in event ? { reason: event.reason } : {}),
    checks: event.checks,
    elapsedMs: event.elapsedMs,
    ...("error" in event ? { error: errorSummary(event.error) } : {}),
  };
}
