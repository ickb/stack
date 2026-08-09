import { describe, expect, it } from "vitest";
import { classifyActorResult } from "../../../../src/supervisor/index.ts";
import {
  BOT_DECISION_SKIPPED,
  BOT_ITERATION_FAILED,
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_FAILED,
  CLASSIFICATION_SUITE,
  INVALID_TX_HASH,
  TRANSACTION_CONFIRMATION_TIMEOUT,
  botCommitStdout,
  botEvent,
  commandResult,
  emptyActions,
  profitableBotMatchDecision,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot confirmation timeouts before wrapper iteration failures", () => {
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
      botEvent("bot.transaction.sent", {
        iterationId: 1,
        txHash: txHash("47"),
        outcome: "broadcasted",
      }),
      botEvent(BOT_TRANSACTION_FAILED, {
        iterationId: 1,
        phase: "confirmation",
        outcome: "timeout",
        txHash: txHash("47"),
        status: "pending",
      }),
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 1,
        retryable: false,
        terminal: true,
        error: {
          name: "TransactionConfirmationError",
          message: TRANSACTION_CONFIRMATION_TIMEOUT,
          txHash: txHash("47"),
          status: "pending",
          isTimeout: true,
        },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "confirmation_timeout",
      terminal: true,
      reason: "bot tx confirmation timed out",
      txHashes: [txHash("47")],
    });
  });

  it.each([
    ["rejected", "terminal_chain_rejection"],
    ["unresolved", "post_broadcast_unresolved"],
  ] as const)(
    "classifies producer confirmation_failed status %s",
    (status, expectedOutcome) => {
      const stdout = stringifyJsonLine(
        botEvent(BOT_TRANSACTION_FAILED, {
          iterationId: 1,
          phase: "confirmation",
          outcome: "confirmation_failed",
          status,
          txHash: txHash("4f"),
          retryable: false,
          terminal: true,
        }),
      );

      expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
        outcome: expectedOutcome,
        terminal: true,
        txHashes: [txHash("4f")],
      });
    },
  );
});

describe(CLASSIFICATION_SUITE, () => {
  it("stops on committed match-only bot transactions that do not beat the fee", () => {
    const stdout = botCommitStdout({
      txByte: "48",
      actions: { ...emptyActions(), matchedOrders: 1 },
      decision: {
        match: { value: "1000" },
        fee: { estimated: "10" },
        exchangeRatio: { ckbScale: "100" },
      },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "economic_loss",
      terminal: true,
      reason: "bot committed match-only transaction value did not exceed tx fee",
      txHashes: [txHash("48")],
      actions: { matchedOrders: 1, deposits: 0 },
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("requires economic evidence on committed match-only bot transactions", () => {
    const stdout = botCommitStdout({
      txByte: "49",
      actions: { ...emptyActions(), matchedOrders: 1 },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot committed match-only transaction evidence did not include economic value fields",
      txHashes: [txHash("49")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not apply match-only economics to combined bot transactions", () => {
    const stdout = botCommitStdout({
      txByte: "4a",
      actions: { ...emptyActions(), matchedOrders: 1, deposits: 1 },
      decision: {
        match: { value: "0" },
        fee: { estimated: "10" },
        exchangeRatio: { ckbScale: "100" },
      },
    });

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_match_plus_deposit_committed",
      terminal: false,
      txHashes: [txHash("4a")],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("rejects bot post-broadcast failures without a valid tx hash", () => {
    const stdout = JSON.stringify(
      botEvent(BOT_TRANSACTION_FAILED, {
        phase: "confirmation",
        outcome: "confirmation_failed",
        status: "unresolved",
        txHash: INVALID_TX_HASH,
      }),
    );

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      reason:
        "bot post-broadcast transaction failure evidence did not include a valid tx hash",
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it.each([0, 1])(
    "classifies producer send failures without tx hashes at exit status %i",
    (status) => {
      const stdout = JSON.stringify(
        botEvent(BOT_TRANSACTION_FAILED, {
          phase: "broadcast",
          outcome: "send_failed",
          retryable: false,
          terminal: true,
        }),
      );

      expect(
        classifyActorResult("bot", {
          ...commandResult("bot", stdout),
          status,
        }),
      ).toMatchObject({
        outcome: "unknown",
        terminal: true,
        reason: "bot transaction broadcast failed",
        txHashes: [],
      });
    },
  );
});

describe(CLASSIFICATION_SUITE, () => {
  it("leaves producer retryable send failures under iteration ownership", () => {
    const stdout = [
      botEvent(BOT_TRANSACTION_FAILED, {
        phase: "broadcast",
        outcome: "send_failed",
        retryable: true,
        terminal: false,
      }),
      botEvent(BOT_ITERATION_FAILED, {
        retryable: true,
        terminal: false,
        error: { name: "Error", message: "RBF rejected" },
      }),
    ]
      .map(stringifyJsonLine)
      .join("\n");

    expect(classifyActorResult("bot", commandResult("bot", stdout))).toMatchObject({
      outcome: "bot_retryable_error",
      terminal: false,
      reason: "bot reported retryable iteration failure",
      retryableFailures: [
        {
          type: BOT_TRANSACTION_FAILED,
          phase: "broadcast",
          outcome: "send_failed",
        },
        { type: BOT_ITERATION_FAILED },
      ],
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("classifies bot skips after earlier terminal iteration failures", () => {
    const stdout = [
      botEvent(BOT_ITERATION_FAILED, {
        iterationId: 1,
        retryable: false,
        terminal: true,
        error: {
          name: "Error",
          message: "deterministic state failure",
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
    });
  });
});
