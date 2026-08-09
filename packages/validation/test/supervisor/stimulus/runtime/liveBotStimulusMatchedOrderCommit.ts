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
  it("passes only after a live bot matched-order commit", () => {
    const state = createBotEventScanState(0);
    consumeBotEventText(
      state,
      `${JSON.stringify(
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
      )}\n`,
      10,
    );
    expect(state.match).toBeUndefined();

    consumeBotEventText(
      state,
      `${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("aa"), outcome: "committed" }))}\n`,
      20,
    );
    expect(state.match).toMatchObject({
      txHash: txHash("aa"),
      iterationId: 7,
      runId: "run-1",
      matchedOrderOutPoints: [{ txHash: txHash("aa"), index: "0" }],
    });
  });

  it("reads matched order outpoints from built transaction match events", () => {
    const state = createBotEventScanState(0);
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
            match: { matchedOrderOutPoints: [{ txHash: txHash("bb"), index: "1" }] },
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
      20,
    );

    expect(state.match).toMatchObject({
      txHash: txHash("cc"),
      matchedOrderOutPoints: [{ txHash: txHash("bb"), index: "1" }],
    });
  });
});
