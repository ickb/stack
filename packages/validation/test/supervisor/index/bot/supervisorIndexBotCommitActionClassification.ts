import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_STATE_READ,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  CLASSIFICATION_SUITE,
  botCommitStdout,
  botEvent,
  botStateReadEvent,
  commandResult,
  emptyActions,
  stringifyJsonLine,
  txHash,
  withBalanceEvidence,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot committed actions", () => {
    const actions = {
      collectedOrders: 0,
      completedDeposits: 0,
      matchedOrders: 1,
      deposits: 1,
      withdrawalRequests: 0,
      withdrawals: 0,
    };
    const stdout = botCommitStdout({
      txByte: "33",
      actions,
      stateBefore: {
        orders: { marketCount: 4, userCount: 0, receiptCount: 1 },
        poolDeposits: { totalCount: 6, readyCount: 2 },
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
        rebalance: {
          kind: "deposit",
          reason: "ring_inventory",
        },
        audit: {
          selectedRing: {
            canCreateRingInventory: true,
            targetUdtValue: "2000",
            totalPoolUdt: "3000",
          },
        },
      },
    });
    const classification = classifyActorResult("bot", commandResult("bot", stdout));

    expect(classification.outcome).toBe("bot_match_plus_deposit_committed");
    expect(classification.txHashes).toEqual([txHash("33")]);
    expect(classification.publicState).toEqual({
      marketOrderCount: 4,
      userOrderCount: 0,
      receiptCount: 1,
      ckbToUdtMatchableOrderCount: 5,
      udtToCkbMatchableOrderCount: 6,
      viableMatchCandidateCount: 7,
      positiveGainMatchCandidateCount: 8,
      rebalanceKind: "deposit",
      rebalanceReason: "ring_inventory",
      poolDepositCount: 6,
      readyPoolDepositCount: 2,
      ringCanCreateInventory: true,
      ringTargetSegmentUdtValue: "2000",
      ringTotalPoolUdt: "3000",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies matched withdrawal requests as withdrawal coverage", () => {
    const stdout = botCommitStdout({
      txByte: "39",
      actions: { ...emptyActions(), matchedOrders: 1, withdrawalRequests: 1 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_withdrawal_request_committed",
      actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 1 },
      txHashes: [txHash("39")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies matched receipt completions as receipt coverage", () => {
    const stdout = botCommitStdout({
      txByte: "40",
      actions: { ...emptyActions(), completedDeposits: 1, matchedOrders: 1 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_receipt_completion_committed",
      actions: { completedDeposits: 1, matchedOrders: 1, deposits: 0 },
      txHashes: [txHash("40")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies matched withdrawal completions as withdrawal completion coverage", () => {
    const stdout = botCommitStdout({
      txByte: "41",
      actions: { ...emptyActions(), matchedOrders: 1, withdrawals: 1 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_withdrawal_completion_committed",
      actions: { matchedOrders: 1, deposits: 0, withdrawals: 1 },
      txHashes: [txHash("41")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies deposit-only commits as deposit coverage", () => {
    const stdout = botCommitStdout({
      txByte: "42",
      actions: { ...emptyActions(), deposits: 1 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_deposit_only_committed",
      actions: { matchedOrders: 0, deposits: 1 },
      txHashes: [txHash("42")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("treats committed bot transactions without classifiable actions as terminal", () => {
    const stdout = botCommitStdout({ txByte: "47", actions: emptyActions() });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "unknown",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include classifiable action evidence",
      actions: {
        matchedOrders: 0,
        deposits: 0,
        withdrawalRequests: 0,
        completedDeposits: 0,
        withdrawals: 0,
      },
      txHashes: [txHash("47")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed bot action counts that are not non-negative safe integers", () => {
    const stdout = botCommitStdout({
      txByte: "58",
      actions: { ...emptyActions(), deposits: 0.5 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot action count evidence contained invalid count",
      txHashes: [txHash("58")],
    });

    expect(
      classifyActorResult(
        "bot",
        commandResult(
          "bot",
          botCommitStdout({
            txByte: "59",
            actions: { ...emptyActions(), withdrawals: Number.MAX_SAFE_INTEGER + 1 },
          }),
        ),
      ),
    ).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot action count evidence contained invalid count",
      txHashes: [txHash("59")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bounded bot commits without next-cycle balance evidence", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const decision = withBalanceEvidence({});
    const stdout = [
      botStateReadEvent({ runId: "run-1", iterationId: 1 }),
      botEvent(BOT_TRANSACTION_BUILT, { actions, decision }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: txHash("55"),
        status: "committed",
        runId: "run-1",
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_deposit_only_committed",
      terminal: false,
      txHashes: [txHash("55")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects previous-cycle balances that do not match the built decision", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const decision = withBalanceEvidence({});
    const stdout = [
      botStateReadEvent({
        balances: {
          availableCkb: "1001",
          availableIckb: "2000",
          unavailableCkb: "3000",
          totalCkb: "4000",
        },
      }),
      botEvent(BOT_TRANSACTION_BUILT, { actions, decision }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: txHash("52"),
        status: "committed",
      }),
      botStateReadEvent({ iterationId: 2 }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot previous-cycle balance evidence did not match built balance evidence",
      txHashes: [txHash("52")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed bot transactions without previous-cycle balance evidence", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const stdout = [
      botEvent(BOT_TRANSACTION_BUILT, {
        actions,
        decision: withBalanceEvidence({}),
      }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: txHash("53"),
        status: "committed",
      }),
      botStateReadEvent({ iterationId: 2 }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include previous-cycle balance evidence",
      txHashes: [txHash("53")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects previous-cycle balance evidence with missing fields", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const decision = {
      balances: {
        availableCkb: "1000",
        availableIckb: "2000",
        unavailableCkb: "3000",
      },
    };
    const stdout = [
      botEvent(BOT_STATE_READ, {
        iterationId: 1,
        balances: {
          availableCkb: "1000",
          availableIckb: "2000",
          unavailableCkb: "3000",
        },
      }),
      botEvent(BOT_TRANSACTION_BUILT, { actions, decision }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: txHash("54"),
        status: "committed",
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason: "bot previous-cycle balance evidence did not match built balance evidence",
      txHashes: [txHash("54")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects committed bot transactions when built evidence appears after commit", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const stdout = [
      botStateReadEvent({ iterationId: 1 }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        iterationId: 1,
        txHash: txHash("56"),
        status: "committed",
      }),
      botEvent(BOT_TRANSACTION_BUILT, {
        iterationId: 1,
        actions,
        decision: withBalanceEvidence({}),
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed transaction evidence did not include matching built action evidence",
      txHashes: [txHash("56")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("ignores incomplete next-cycle balance evidence", () => {
    const actions = { ...emptyActions(), deposits: 1 };
    const decision = withBalanceEvidence({});
    const stdout = [
      botStateReadEvent({ iterationId: 1 }),
      botEvent(BOT_TRANSACTION_BUILT, { actions, decision }),
      botEvent(BOT_TRANSACTION_COMMITTED, {
        txHash: txHash("57"),
        status: "committed",
      }),
      botEvent(BOT_STATE_READ, {
        iterationId: 2,
        balances: {
          availableCkb: "1000",
          availableIckb: "2000",
          unavailableCkb: "3000",
        },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_deposit_only_committed",
      terminal: false,
      txHashes: [txHash("57")],
    });
  });
});
