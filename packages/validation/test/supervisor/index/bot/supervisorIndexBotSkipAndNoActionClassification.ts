import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_ITERATION_FAILED,
  BOT_STATE_READ,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  BOT_TRANSACTION_FAILED,
  CLASSIFICATION_SUITE,
  INVALID_TX_HASH,
  botCommitStdout,
  botEvent,
  commandResult,
  emptyActions,
  profitableBotMatchDecision,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("classifies independent actions despite incomplete empty-match evidence", () => {
    const stdout = botCommitStdout({
      txByte: "47",
      actions: { ...emptyActions(), collectedOrders: 1, deposits: 1 },
      decision: {
        match: {
          reason: "search_incomplete",
          partialCount: 0,
          search: incompleteMatchSearchEvidence(),
        },
      },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_deposit_only_committed",
      terminal: false,
      actions: { collectedOrders: 1, matchedOrders: 0, deposits: 1 },
    });
  });

  it("treats an incomplete empty-match skip as terminal inspection evidence", () => {
    const stdout = JSON.stringify(
      botEvent(BOT_DECISION_SKIPPED, {
        reason: "match_search_incomplete",
        actions: emptyActions(),
        decision: {
          match: {
            reason: "search_incomplete",
            partialCount: 0,
            search: incompleteMatchSearchEvidence(),
          },
        },
      }),
    );

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_terminal_error",
      terminal: true,
      reason: "bot match search incomplete; inspect decision evidence",
      skipReason: "match_search_incomplete",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies latest terminal bot iteration failures from structured evidence", () => {
    const stdout = [
      botEvent("bot.run.started", {}),
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 1,
        retryable: false,
        terminal: true,
        error: {
          name: "Error",
          message: "Id mismatched, got null, expected 319",
        },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_terminal_error",
      terminal: true,
      reason:
        "bot reported terminal iteration failure: Id mismatched, got null, expected 319",
    });
  });
});

function incompleteMatchSearchEvidence(): Record<string, unknown> {
  return {
    kind: "incomplete",
    reason: "candidate_budget_exhausted",
    searchMode: "stepped",
    budget: 7,
    work: 7,
    truncation: { phase: "candidates", requiredWork: "8" },
  };
}

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot skips after earlier retryable send failures", () => {
    const stdout = [
      botEvent(BOT_TRANSACTION_FAILED, {
        iterationId: 1,
        phase: "broadcast",
        outcome: "send_failed",
        retryable: true,
        terminal: false,
        error: {
          name: "Error",
          code: -1111,
          currentFee: "36113",
          leastFee: "39371",
          message: "RBF rejected",
        },
      }),
      botEvent(BOT_DECISION_SKIPPED, {
        iterationId: 2,
        reason: "no_actions",
        actions: emptyActions(),
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_no_action_skip",
      terminal: false,
      skipReason: "no_actions",
      retryableFailures: [
        {
          actor: "bot",
          type: BOT_TRANSACTION_FAILED,
          iterationId: 1,
          phase: "broadcast",
          outcome: "send_failed",
          errorName: "Error",
          errorCode: -1111,
          currentFee: "36113",
          leastFee: "39371",
        },
      ],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed bot evidence without matching built action evidence", () => {
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
        iterationId: 2,
        txHash: txHash("38"),
        status: "committed",
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include matching built action evidence",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed bot evidence without a valid tx hash", () => {
    const stdout = [
      botEvent(BOT_TRANSACTION_BUILT, {
        actions: {
          collectedOrders: 0,
          completedDeposits: 0,
          matchedOrders: 1,
          deposits: 1,
          withdrawalRequests: 0,
          withdrawals: 0,
        },
      }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: INVALID_TX_HASH,
        status: "committed",
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot committed transaction evidence did not include a valid tx hash",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot no-action and low-capital skips", () => {
    expect(
      classifyActorResult(
        "bot",
        commandResult(
          "bot",
          JSON.stringify(
            botEvent(BOT_DECISION_SKIPPED, {
              reason: "no_actions",
              actions: emptyActions(),
            }),
          ),
        ),
      ).outcome,
    ).toBe("bot_no_action_skip");
    expect(
      classifyActorResult(
        "bot",
        commandResult(
          "bot",
          JSON.stringify(
            botEvent(BOT_DECISION_SKIPPED, {
              reason: "capital_below_minimum",
              actions: emptyActions(),
            }),
          ),
        ),
      ).outcome,
    ).toBe("low_capital_stop");
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("summarizes latest bot rebalance evaluation for no-action stops", () => {
    const stdout = [
      botEvent(BOT_STATE_READ, {
        iterationId: 3,
        orders: { marketCount: 1, userCount: 0, receiptCount: 0 },
        poolDeposits: { totalCount: 2, readyCount: 2 },
      }),
      botEvent("bot.rebalance.evaluated", {
        iterationId: 3,
        rebalance: {
          kind: "none",
          reason: "no_ring_surplus_ready_deposits",
          diagnostics: {
            ring: {
              canCreateRingInventory: false,
              targetSegmentUdtValue: "0",
              totalPoolUdt: "4000",
            },
          },
        },
      }),
      botEvent(BOT_DECISION_SKIPPED, {
        iterationId: 3,
        reason: "no_actions",
        actions: emptyActions(),
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_no_action_skip",
      reason:
        "bot skipped: no_actions; rebalance=none/no_ring_surplus_ready_deposits; readyPoolDeposits=2",
      publicState: {
        marketOrderCount: 1,
        rebalanceKind: "none",
        rebalanceReason: "no_ring_surplus_ready_deposits",
        ringCanCreateInventory: false,
        ringTargetSegmentUdtValue: "0",
        ringTotalPoolUdt: "4000",
      },
    });
  });
});
