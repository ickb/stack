import { describe, expect, it } from "vitest";
import {
  consumeBotEventText,
  createBotEventScanState,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  LIVE_BOT_STIMULUS_SUITE,
  botEvent,
  matchedOrderDecision,
  txHash,
} from "../../support/stimulus/liveBotStimulus.ts";

const BOT_DECISION_SKIPPED = "bot.decision.skipped";
const BOT_ITERATION_FAILED = "bot.iteration.failed";
const REQUIRED_ORDER_BYTE = "dd";

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  registerCommitBoundaryTests();
  registerRetryableFailureTests();
});

function registerCommitBoundaryTests(): void {
  it("does not pass deposit-only commits", () => {
    const state = scanEvents(createBotEventScanState(0), [
      botEvent(BOT_TRANSACTION_BUILT, { actions: depositOnlyActions() }),
      committedEvent("bb"),
    ]);

    expect(state.match).toBeUndefined();
    expect(state.latestCommit).toMatchObject({ txHash: txHash("bb") });
  });

  it("matches when built evidence arrives after commit evidence", () => {
    const state = scanEvents(createBotEventScanState(0), [
      committedEvent("ba"),
      matchedBuiltEvent("ba"),
    ]);

    expect(state.match).toMatchObject({ txHash: txHash("ba") });
  });

  it("treats terminal failures after matched commits as failure", () => {
    const state = scanEvents(createBotEventScanState(0), [
      matchedBuiltEvent("bc"),
      committedEvent("bc"),
      terminalFailureEvent(),
    ]);

    expect(state.match).toMatchObject({ txHash: txHash("bc") });
    expect(state.latestFailure).toMatchObject({
      type: BOT_ITERATION_FAILED,
      terminal: true,
    });
  });

  it("accepts quiescence only after a later skip reports no orders or receipts", () => {
    const state = scanEvents(createBotEventScanState(0), [
      matchedBuiltEvent("bd"),
      committedEvent("bd"),
    ]);

    for (const [iterationId, orders] of [
      [8, undefined],
      [9, { marketCount: 1, receiptCount: 0 }],
      [10, { marketCount: 0, receiptCount: 1 }],
    ] as const) {
      scanEvents(state, [
        botEvent(BOT_DECISION_SKIPPED, {
          iterationId,
          reason: "no_actions",
          ...(orders === undefined ? {} : { decision: { orders } }),
        }),
      ]);
      expect(state.quiescenceSkip).toBeUndefined();
    }

    scanEvents(state, [
      botEvent(BOT_DECISION_SKIPPED, {
        iterationId: 11,
        reason: "no_actions",
        decision: { orders: { marketCount: 0, receiptCount: 0 } },
      }),
    ]);
    expect(state.quiescenceSkip).toMatchObject({ iterationId: 11 });
  });
}

function registerRetryableFailureTests(): void {
  it("preserves retryable matched-order failures without marking them terminal", () => {
    const state = scanEvents(
      createBotEventScanState(0, txHash(REQUIRED_ORDER_BYTE)),
      retryableMatchedFailureEvents(REQUIRED_ORDER_BYTE),
    );

    expect(state.latestFailure).toMatchObject({
      type: BOT_ITERATION_FAILED,
      retryable: true,
      terminal: false,
    });
    expect(state.latestMatchedOrderFailure).toMatchObject({
      iterationId: 7,
      matchedOrderOutPoints: [{ txHash: txHash(REQUIRED_ORDER_BYTE), index: "0" }],
      requiredOrderTxHash: txHash(REQUIRED_ORDER_BYTE),
      failure: {
        type: BOT_ITERATION_FAILED,
        retryable: true,
        terminal: false,
        error: { message: "unknown outpoint" },
      },
    });
  });

  it("ignores retryable matched-order failures for unrelated orders", () => {
    const unrelatedState = scanEvents(createBotEventScanState(0, txHash("ff")), [
      matchedBuiltEvent(REQUIRED_ORDER_BYTE),
      retryableFailureEvent(),
    ]);

    expect(unrelatedState.latestMatchedOrderFailure).toBeUndefined();
  });

  it("ignores retryable matched-order failures without matching built evidence", () => {
    const missingBuiltState = scanEvents(
      createBotEventScanState(0, txHash(REQUIRED_ORDER_BYTE)),
      [retryableFailureEvent()],
    );

    expect(missingBuiltState.latestMatchedOrderFailure).toBeUndefined();
  });

  it("ignores retryable matched-order failures with invalid order outpoints", () => {
    const state = scanEvents(createBotEventScanState(0, txHash(REQUIRED_ORDER_BYTE)), [
      botEvent(BOT_TRANSACTION_BUILT, {
        actions: matchedActions(),
        decision: {
          match: {
            matchedOrderOutPoints: [],
            matchedOrderMasterOutPoints: [{ txHash: "bad", index: "0" }],
          },
        },
      }),
      retryableFailureEvent(),
    ]);

    expect(state.latestMatchedOrderFailure).toBeUndefined();
  });

  it("counts malformed order outpoint evidence as malformed", () => {
    const state = scanEvents(createBotEventScanState(0), [
      botEvent(BOT_TRANSACTION_BUILT, {
        actions: matchedActions(),
        decision: { match: { matchedOrderOutPoints: "bad" } },
      }),
      botEvent(BOT_TRANSACTION_BUILT, {
        actions: matchedActions(),
        decision: { match: { matchedOrderOutPoints: ["bad"] } },
      }),
    ]);

    expect(state.acceptedEventCount).toBe(0);
    expect(state.malformedLineCount).toBe(2);
  });

  it("omits retryable matched-order failure error when the bot event omits it", () => {
    const noErrorState = scanEvents(createBotEventScanState(0), [
      matchedBuiltEvent(REQUIRED_ORDER_BYTE),
      retryableFailureEvent(),
    ]);

    expect(noErrorState.latestMatchedOrderFailure?.failure).not.toHaveProperty("error");
    expect(noErrorState.latestMatchedOrderFailure).not.toHaveProperty(
      "requiredOrderTxHash",
    );
  });
}

function scanEvents(
  state: ReturnType<typeof createBotEventScanState>,
  events: Array<Record<string, unknown>>,
): ReturnType<typeof createBotEventScanState> {
  consumeBotEventText(
    state,
    [...events.map((event) => JSON.stringify(event)), ""].join("\n"),
    100,
  );
  return state;
}

function matchedBuiltEvent(matchByte: string): Record<string, unknown> {
  return botEvent(BOT_TRANSACTION_BUILT, {
    actions: matchedActions(),
    ...matchedOrderDecision(matchByte),
  });
}

function committedEvent(matchByte: string): Record<string, unknown> {
  return botEvent(BOT_TRANSACTION_COMMITTED, {
    txHash: txHash(matchByte),
    outcome: "committed",
  });
}

function terminalFailureEvent(): Record<string, unknown> {
  return botEvent(BOT_ITERATION_FAILED, {
    terminal: true,
    retryable: false,
    error: { message: "boom" },
  });
}

function retryableFailureEvent(fields = {}): Record<string, unknown> {
  return botEvent(BOT_ITERATION_FAILED, {
    retryable: true,
    terminal: false,
    ...fields,
  });
}

function retryableMatchedFailureEvents(
  matchByte: string,
): Array<Record<string, unknown>> {
  return [
    matchedBuiltEvent(matchByte),
    retryableFailureEvent({ error: { message: "unknown outpoint" } }),
    botEvent(BOT_DECISION_SKIPPED, { iterationId: 8, reason: "no_actions" }),
    botEvent(BOT_TRANSACTION_COMMITTED, {
      iterationId: 8,
      txHash: txHash("ee"),
      outcome: "committed",
    }),
  ];
}

function matchedActions(): Record<string, number> {
  return {
    matchedOrders: 1,
    deposits: 0,
    withdrawalRequests: 0,
    completedDeposits: 0,
    withdrawals: 0,
    collectedOrders: 0,
  };
}

function depositOnlyActions(): Record<string, number> {
  return {
    ...matchedActions(),
    matchedOrders: 0,
    deposits: 1,
  };
}
