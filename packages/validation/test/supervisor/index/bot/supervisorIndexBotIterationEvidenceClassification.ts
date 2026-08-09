import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_ITERATION_FAILED,
  BOT_MATCH_COMMITTED,
  BOT_STATE_READ,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  BOT_TRANSACTION_FAILED,
  CLASSIFICATION_SUITE,
  FETCH_FAILED,
  botEvent,
  botStateReadEvent,
  commandResult,
  emptyActions,
  profitableBotMatchDecision,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("keeps match diagnostics tied to the matching state-read iteration", () => {
    const stdout = [
      botEvent(BOT_STATE_READ, {
        iterationId: 1,
        orders: { marketCount: 4, userCount: 0, receiptCount: 1 },
        poolDeposits: { totalCount: 6, readyCount: 2 },
      }),
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 1,
        actions: {
          collectedOrders: 0,
          completedDeposits: 0,
          matchedOrders: 1,
          deposits: 1,
          withdrawalRequests: 0,
          withdrawals: 0,
        },
        decision: {
          match: {
            diagnostics: {
              directions: {
                ckbToUdt: { matchableCount: 5 },
                udtToCkb: { matchableCount: 6 },
              },
              candidates: { viable: 7, positiveGain: 8 },
            },
          },
        },
      }),
      botEvent(BOT_STATE_READ, {
        iterationId: 2,
        orders: { marketCount: 9, userCount: 1, receiptCount: 0 },
        poolDeposits: { totalCount: 0, readyCount: 0 },
      }),
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 2,
        retryable: true,
        terminal: false,
        error: { name: "TypeError", message: FETCH_FAILED },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");
    const classification = classifyActorResult("bot", commandResult("bot", stdout));

    expect(classification.publicState).toEqual({
      marketOrderCount: 9,
      userOrderCount: 1,
      receiptCount: 0,
      ckbToUdtMatchableOrderCount: undefined,
      udtToCkbMatchableOrderCount: undefined,
      viableMatchCandidateCount: undefined,
      positiveGainMatchCandidateCount: undefined,
      poolDepositCount: 0,
      readyPoolDepositCount: 0,
      rebalanceKind: undefined,
      rebalanceReason: undefined,
      ringCanCreateInventory: undefined,
      ringTargetSegmentUdtValue: undefined,
      ringTotalPoolUdt: undefined,
    });
    expect(classification).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: false,
      reason: "bot reported retryable iteration failure",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot committed actions from the matching iteration", () => {
    const matchedActions = { ...emptyActions(), matchedOrders: 1 };
    const matchedDecision = profitableBotMatchDecision();
    const stdout = [
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 0,
        retryable: false,
        terminal: true,
        error: {
          name: "Error",
          message: "deterministic state failure",
        },
      }),
      botStateReadEvent({ iterationId: 1 }),
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 1,
        actions: matchedActions,
        decision: matchedDecision,
      }),
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 2,
        actions: {
          collectedOrders: 0,
          completedDeposits: 0,
          matchedOrders: 0,
          deposits: 1,
          withdrawalRequests: 0,
          withdrawals: 0,
        },
      }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        iterationId: 1,
        txHash: txHash("37"),
        status: "committed",
      }),
      botStateReadEvent({ iterationId: 2 }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: BOT_MATCH_COMMITTED,
      actions: { matchedOrders: 1, deposits: 0 },
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies later bot commits over older transaction failures", () => {
    const matchedActions = { ...emptyActions(), matchedOrders: 1 };
    const matchedDecision = profitableBotMatchDecision();
    const stdout = [
      botStateReadEvent({ iterationId: 1 }),
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 1,
        actions: matchedActions,
        decision: matchedDecision,
      }),
      botEvent(BOT_TRANSACTION_FAILED, {
        iterationId: 1,
        phase: "confirmation",
        outcome: "confirmation_failed",
        status: "unresolved",
        retryable: false,
        terminal: true,
        txHash: txHash("43"),
      }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        iterationId: 1,
        txHash: txHash("44"),
        status: "committed",
      }),
      botStateReadEvent({ iterationId: 2 }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: BOT_MATCH_COMMITTED,
      terminal: false,
      actions: { matchedOrders: 1, deposits: 0 },
      txHashes: [txHash("44")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies later bot transaction failures over older commits", () => {
    const stdout = [
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 1,
        actions: {
          collectedOrders: 0,
          completedDeposits: 0,
          matchedOrders: 1,
          deposits: 0,
          withdrawalRequests: 0,
          withdrawals: 0,
        },
        decision: profitableBotMatchDecision(),
      }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        iterationId: 1,
        txHash: txHash("45"),
        status: "committed",
      }),
      botEvent(BOT_TRANSACTION_FAILED, {
        iterationId: 1,
        phase: "confirmation",
        outcome: "confirmation_failed",
        status: "rejected",
        retryable: false,
        terminal: true,
        txHash: txHash("46"),
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "terminal_chain_rejection",
      terminal: true,
      txHashes: [txHash("46")],
    });
  });
});
