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

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("keeps the first matched-order commit when a later match appears in the same scan", () => {
    const state = createBotEventScanState(
      0,
      txHash("aa").toUpperCase().replace("0X", "0x"),
    );
    consumeBotEventText(
      state,
      [
        JSON.stringify(
          botEvent(BOT_TRANSACTION_BUILT, {
            actions: {
              matchedOrders: 1,
              deposits: 0,
              withdrawalRequests: 0,
              completedDeposits: 0,
              withdrawals: 0,
              collectedOrders: 0,
            },
            ...matchedOrderDecision("aa"),
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_COMMITTED, {
            txHash: txHash("cc"),
            outcome: "committed",
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_BUILT, {
            iterationId: 8,
            actions: {
              matchedOrders: 1,
              deposits: 0,
              withdrawalRequests: 0,
              completedDeposits: 0,
              withdrawals: 0,
              collectedOrders: 0,
            },
            ...matchedOrderDecision("bb"),
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_COMMITTED, {
            iterationId: 8,
            txHash: txHash("dd"),
            outcome: "committed",
          }),
        ),
        "",
      ].join("\n"),
      200,
    );

    expect(state.match).toMatchObject({
      txHash: txHash("cc"),
      matchedOrderOutPoints: [{ txHash: txHash("aa"), index: "0" }],
      requiredOrderTxHash: txHash("aa"),
    });
  });
});

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("accepts a matched-order commit even when the matched outpoint is a descendant", () => {
    const state = createBotEventScanState(0, txHash("aa"));

    consumeBotEventText(
      state,
      [
        JSON.stringify(
          botEvent(BOT_TRANSACTION_BUILT, {
            actions: {
              matchedOrders: 1,
              deposits: 0,
              withdrawalRequests: 0,
              completedDeposits: 0,
              withdrawals: 0,
              collectedOrders: 0,
            },
            ...matchedOrderDecision("bb", "aa"),
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_COMMITTED, {
            txHash: txHash("cc"),
            outcome: "committed",
          }),
        ),
        "",
      ].join("\n"),
      200,
    );

    expect(state.match).toMatchObject({
      txHash: txHash("cc"),
      matchedOrderOutPoints: [{ txHash: txHash("bb"), index: "0" }],
      requiredOrderTxHash: txHash("aa"),
    });
  });
});

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("does not treat co-observed outpoints as descendant proof", () => {
    const state = createBotEventScanState(0, txHash("aa"));

    consumeBotEventText(
      state,
      [
        JSON.stringify(
          botEvent("bot.decision.skipped", {
            reason: "post_tx_ckb_reserve",
            decision: {
              match: {
                matchedOrderOutPoints: [
                  { txHash: txHash("aa"), index: "0" },
                  { txHash: txHash("bb"), index: "0" },
                ],
              },
            },
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_BUILT, {
            actions: {
              matchedOrders: 1,
              deposits: 0,
              withdrawalRequests: 0,
              completedDeposits: 0,
              withdrawals: 0,
              collectedOrders: 0,
            },
            decision: {
              match: {
                matchedOrderOutPoints: [{ txHash: txHash("bb"), index: "0" }],
              },
            },
          }),
        ),
        JSON.stringify(
          botEvent(BOT_TRANSACTION_COMMITTED, {
            txHash: txHash("cc"),
            outcome: "committed",
          }),
        ),
        "",
      ].join("\n"),
      200,
    );

    expect(state.match).toBeUndefined();
  });
});
