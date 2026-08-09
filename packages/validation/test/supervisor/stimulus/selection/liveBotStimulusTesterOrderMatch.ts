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
  it("does not accept unrelated matches after observing the tester order", () => {
    const state = createBotEventScanState(0, txHash("aa"));

    consumeBotEventText(
      state,
      `${JSON.stringify(
        botEvent("bot.decision.skipped", {
          reason: "post_tx_ckb_reserve",
          ...matchedOrderDecision("aa"),
        }),
      )}\n`,
      100,
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
            ...matchedOrderDecision("bb"),
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

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("passes only when the bot matched the tester-created order", () => {
    const state = createBotEventScanState(0, txHash("aa"));
    consumeBotEventText(
      state,
      [
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
            txHash: txHash("bb"),
            outcome: "committed",
          }),
        ),
        "",
      ].join("\n"),
      100,
    );
    expect(state.match).toBeUndefined();

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
        "",
      ].join("\n"),
      200,
    );
    expect(state.match).toMatchObject({
      txHash: txHash("cc"),
      matchedOrderOutPoints: [{ txHash: txHash("aa"), index: "0" }],
    });
  });
});
