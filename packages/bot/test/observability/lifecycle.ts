import { expect, it } from "vitest";
import { transactionLifecycleEvents } from "../../src/observability/lifecycle.ts";
import {
  BOT_TRANSACTION_FAILED,
  POOL_REJECTED_RBF_MESSAGE,
  RBF_REJECTED_DATA,
  RESOLVE_FAILED_DEAD,
} from "./fixtures/observability.ts";

const BOT_TRANSACTION_CONFIRMATION = "bot.transaction.confirmation";
const PHASE_CONFIRMATION = "confirmation";
const POST_BROADCAST_FAILURE = "post-broadcast failure";
const POST_BROADCAST_UNRESOLVED = "post_broadcast_unresolved";
const RBF_REJECTED_CONFIRMATION_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"22".repeat(32)})`,
});

it("maps terminal lifecycle callbacks into confirmation and failure events", () => {
  expect(
    transactionLifecycleEvents({
      type: "terminal_rejection",
      txHash: "0x00",
      status: "rejected",
      reason: RESOLVE_FAILED_DEAD,
      checks: 1,
      elapsedMs: 10,
    }),
  ).toEqual([
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: {
        txHash: "0x00",
        phase: PHASE_CONFIRMATION,
        status: "rejected",
        reason: RESOLVE_FAILED_DEAD,
        checks: 1,
        elapsedMs: 10,
        outcome: "terminal_rejection",
        retryable: false,
        terminal: true,
      },
    },
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        txHash: "0x00",
        phase: PHASE_CONFIRMATION,
        status: "rejected",
        reason: RESOLVE_FAILED_DEAD,
        checks: 1,
        elapsedMs: 10,
        outcome: "terminal_rejection",
        retryable: false,
        terminal: true,
      },
    },
  ]);

  expect(
    transactionLifecycleEvents({
      type: "timeout_after_broadcast",
      txHash: "0x01",
      status: "unknown",
      checks: 3,
      elapsedMs: 20,
    }),
  ).toMatchObject([
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: { outcome: "timeout_after_broadcast" },
    },
    { type: BOT_TRANSACTION_FAILED, fields: { outcome: "timeout_after_broadcast" } },
  ]);
});

it("preserves post-broadcast failure errors in lifecycle events", () => {
  const unresolvedError = new Error(POST_BROADCAST_FAILURE);

  expect(
    transactionLifecycleEvents({
      type: POST_BROADCAST_UNRESOLVED,
      txHash: "0x04",
      status: "pending",
      checks: 4,
      elapsedMs: 30,
      error: unresolvedError,
    }),
  ).toMatchObject([
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: {
        outcome: POST_BROADCAST_UNRESOLVED,
        error: { message: POST_BROADCAST_FAILURE },
      },
    },
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        outcome: POST_BROADCAST_UNRESOLVED,
        error: { message: POST_BROADCAST_FAILURE },
      },
    },
  ]);
});

it("marks RBF confirmation rejection lifecycle events as retryable", () => {
  expect(
    transactionLifecycleEvents({
      type: "terminal_rejection",
      txHash: "0x05",
      status: "rejected",
      reason: RBF_REJECTED_CONFIRMATION_REASON,
      checks: 2,
      elapsedMs: 11_019,
    }),
  ).toMatchObject([
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: {
        phase: PHASE_CONFIRMATION,
        txHash: "0x05",
        status: "rejected",
        reason: RBF_REJECTED_CONFIRMATION_REASON,
        outcome: "terminal_rejection",
        retryable: true,
        terminal: false,
      },
    },
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        phase: PHASE_CONFIRMATION,
        txHash: "0x05",
        status: "rejected",
        reason: RBF_REJECTED_CONFIRMATION_REASON,
        outcome: "terminal_rejection",
        retryable: true,
        terminal: false,
      },
    },
  ]);
});

it("maps broadcast and commit lifecycle callbacks into public events", () => {
  expect(
    transactionLifecycleEvents({
      type: "broadcasted",
      txHash: "0x02",
      elapsedMs: 4,
    }),
  ).toEqual([
    {
      type: "bot.transaction.sent",
      fields: {
        txHash: "0x02",
        phase: "broadcast",
        outcome: "broadcasted",
        elapsedMs: 4,
      },
    },
  ]);

  expect(
    transactionLifecycleEvents({
      type: "committed",
      txHash: "0x03",
      status: "committed",
      checks: 2,
      elapsedMs: 6,
    }),
  ).toEqual([
    {
      type: BOT_TRANSACTION_CONFIRMATION,
      fields: {
        phase: PHASE_CONFIRMATION,
        txHash: "0x03",
        status: "committed",
        checks: 2,
        elapsedMs: 6,
        outcome: "committed",
        retryable: false,
        terminal: true,
      },
    },
    {
      type: "bot.transaction.committed",
      fields: {
        phase: PHASE_CONFIRMATION,
        txHash: "0x03",
        status: "committed",
        checks: 2,
        elapsedMs: 6,
        outcome: "committed",
      },
    },
  ]);
});

it("uses the caller-owned retry classifier for pre-broadcast failures", () => {
  const transportEvents = transactionLifecycleEvents(
    {
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error: new TypeError("fetch failed"),
    },
    () => true,
  );
  const rbfEvents = transactionLifecycleEvents(
    {
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error: Object.assign(new Error(POOL_REJECTED_RBF_MESSAGE), {
        code: -1111,
        data: RBF_REJECTED_DATA,
        currentFee: 11795n,
        leastFee: 12326n,
      }),
    },
    () => true,
  );
  const terminalEvents = transactionLifecycleEvents(
    {
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error: new Error("deterministic failure"),
    },
    () => false,
  );

  expect(transportEvents).toMatchObject([
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: true,
        terminal: false,
      },
    },
  ]);
  expect(transportEvents[0]?.fields["error"]).not.toHaveProperty("stack");
  expect(rbfEvents).toMatchObject([
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: true,
        terminal: false,
        error: {
          code: -1111,
          data: RBF_REJECTED_DATA,
          currentFee: "11795",
          leastFee: "12326",
        },
      },
    },
  ]);
  expect(rbfEvents[0]?.fields["error"]).not.toHaveProperty("stack");
  expect(terminalEvents).toMatchObject([
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: false,
        terminal: true,
      },
    },
  ]);
  expect(terminalEvents[0]?.fields["error"]).toHaveProperty("stack");
});

it("treats pre-broadcast failures as terminal without a retry classifier", () => {
  const events = transactionLifecycleEvents({
    type: "pre_broadcast_failed",
    elapsedMs: 12,
    error: new TypeError("fetch failed"),
  });

  expect(events).toMatchObject([
    {
      type: BOT_TRANSACTION_FAILED,
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: false,
        terminal: true,
      },
    },
  ]);
  expect(events[0]?.fields["error"]).toHaveProperty("stack");
});
