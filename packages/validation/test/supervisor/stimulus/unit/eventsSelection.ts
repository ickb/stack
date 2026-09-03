import { expect, it } from "vitest";

import { botEvent, ckb, txHash } from "../../support/stimulus/liveBotStimulus.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOT_DECISION_SKIPPED_EVENT,
  BOT_ITERATION_FAILED_EVENT,
  BOT_TRANSACTION_BUILT_EVENT,
  BOT_TRANSACTION_COMMITTED_EVENT,
  BOT_TRANSACTION_FAILED_EVENT,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  MAX_PENDING_EVENT_TEXT_BYTES,
  MAX_UNMATCHED_ITERATIONS,
  TESTER_ORDER_CREATED,
  assertUnboundedBotLivePreflight,
  balancesFromPreflight,
  chooseLiveBotStimulus,
  consumeBotEventText,
  createBotEventScanState,
  testerOrderCreatedTxHash,
} from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";
import { balances } from "./support.ts";

const MISSING_PUBLIC_BALANCES = "missing public balances";
it("tracks malformed, skipped, failed, and out-of-order bot events", () => {
  const state = createBotEventScanState(5, txHash("aa"));

  expect(consumeBotEventText(state, "", 6).pendingText).toBe("");
  consumeBotEventText(
    state,
    [
      "not-json",
      JSON.stringify(["array"]),
      JSON.stringify({ app: "tester", type: "ignored" }),
      JSON.stringify(botEvent(BOT_DECISION_SKIPPED_EVENT, { reason: "reserve" })),
      JSON.stringify(
        botEvent(BOT_TRANSACTION_FAILED_EVENT, {
          phase: "confirmation",
          outcome: "confirmation_failed",
          status: "unresolved",
          terminal: true,
          retryable: false,
        }),
      ),
      JSON.stringify(
        botEvent(BOT_ITERATION_FAILED_EVENT, { terminal: true, retryable: false }),
      ),
      "",
    ].join("\r\n"),
    50,
  );

  expect(state.malformedLineCount).toBe(3);
  expect(state.acceptedEventCount).toBe(3);
  expect(state.latestSkip).toMatchObject({ reason: "reserve" });
  expect(state.latestFailure).toMatchObject({ type: BOT_ITERATION_FAILED_EVENT });

  consumeBotEventText(
    state,
    `${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("cc") }))}\n`,
    60,
  );
  expect(state.match).toBeUndefined();
  consumeBotEventText(
    state,
    `${JSON.stringify(
      botEvent(BOT_TRANSACTION_BUILT_EVENT, {
        actions: { matchedOrders: 1 },
        decision: {
          match: {
            matchedOrderOutPoints: [
              null,
              { txHash: "bad", index: "0" },
              { txHash: txHash("aa") },
              { txHash: txHash("aa"), index: "1" },
            ],
          },
        },
      }),
    )}\n`,
    70,
  );
  expect(state.match).toBeUndefined();
  expect(state.malformedLineCount).toBe(4);

  consumeBotEventText(
    state,
    `${JSON.stringify(
      botEvent(BOT_TRANSACTION_BUILT_EVENT, { actions: { matchedOrders: 0.5 } }),
    )}\n`,
    75,
  );
  expect(state.malformedLineCount).toBe(5);

  consumeBotEventText(
    state,
    `${JSON.stringify(botEvent(BOT_TRANSACTION_FAILED_EVENT, { outcome: undefined }))}\n`,
    80,
  );
  consumeBotEventText(
    state,
    `${JSON.stringify(botEvent(BOT_TRANSACTION_BUILT_EVENT, { actions: {} }))}\n`,
    90,
  );
});

it("keeps incomplete bot event lines pending", () => {
  const state = createBotEventScanState(0);
  const partial = JSON.stringify({ app: "bot" }).slice(0, 4);

  consumeBotEventText(state, partial, partial.length);

  expect(state.pendingText).toBe(partial);
});

it("fails closed on foreign evidence and bounded scanner state", () => {
  const foreign = createBotEventScanState(0, undefined, "run-1");
  consumeBotEventText(
    foreign,
    `${JSON.stringify({ app: "tester", type: "tester.state" })}\n${JSON.stringify(
      botEvent("bot.state.read", { runId: "other-run" }),
    )}\n`,
    1,
  );
  expect(foreign).toMatchObject({ acceptedEventCount: 0, malformedLineCount: 2 });

  const oversized = createBotEventScanState(0);
  consumeBotEventText(oversized, "x".repeat(MAX_PENDING_EVENT_TEXT_BYTES + 1), 1);
  expect(oversized).toMatchObject({ pendingText: "", malformedLineCount: 1 });

  const unmatched = createBotEventScanState(0);
  const builtEvents = Array.from({ length: MAX_UNMATCHED_ITERATIONS + 1 }, (_, index) =>
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      iterationId: index,
      actions: { matchedOrders: 1 },
    }),
  );
  consumeBotEventText(
    unmatched,
    `${builtEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
    2,
  );
  expect(unmatched.matchedBuiltByIteration.size).toBe(MAX_UNMATCHED_ITERATIONS);
  expect(unmatched.malformedLineCount).toBe(1);
});

it("deletes paired iteration evidence and bounds post-match history", () => {
  const state = createBotEventScanState(0);
  const events = Array.from(
    { length: MAX_UNMATCHED_ITERATIONS + 1 },
    (_, iterationId) => [
      botEvent(BOT_TRANSACTION_BUILT_EVENT, {
        iterationId,
        actions: { matchedOrders: 1 },
      }),
      botEvent(BOT_TRANSACTION_COMMITTED_EVENT, {
        iterationId,
        txHash: txHash("ab"),
      }),
    ],
  ).flat();
  events.push(
    botEvent(BOT_TRANSACTION_COMMITTED_EVENT, {
      iterationId: MAX_UNMATCHED_ITERATIONS + 2,
      txHash: txHash("ab"),
    }),
    botEvent(BOT_TRANSACTION_BUILT_EVENT, {
      iterationId: MAX_UNMATCHED_ITERATIONS + 2,
      actions: { matchedOrders: 1 },
    }),
  );

  consumeBotEventText(
    state,
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    1,
  );

  expect(state.matchedBuiltByIteration.size).toBe(0);
  expect(state.committedByIteration.size).toBe(0);
  expect(state.malformedLineCount).toBe(0);
  expect(state.postMatchCommitCount).toBe(MAX_UNMATCHED_ITERATIONS + 1);
});

it("ignores bot events that cannot be correlated by iteration", () => {
  const state = createBotEventScanState(0);

  consumeBotEventText(
    state,
    `${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { iterationId: undefined, txHash: txHash("dd") }))}\n`,
    1,
  );

  expect(state.match).toBeUndefined();
  expect(state.latestCommit).toBeUndefined();
});

it("extracts fallback match outpoints and tester-created transaction hashes", () => {
  const state = createBotEventScanState(0);

  consumeBotEventText(
    state,
    `${JSON.stringify(
      botEvent(BOT_TRANSACTION_BUILT_EVENT, {
        actions: { matchedOrders: 1 },
        decision: {
          match: { matchedOrderOutPoints: [{ txHash: txHash("ab"), index: "0" }] },
        },
      }),
    )}\n${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("bc") }))}\npartial`,
    10,
  );

  expect(state.pendingText).toBe("partial");
  expect(state.match).toMatchObject({
    matchedOrderOutPoints: [{ txHash: txHash("ab"), index: "0" }],
  });
  expect(
    testerOrderCreatedTxHash({
      testerOrderEvidence: [
        {
          outcome: TESTER_ORDER_CREATED,
          orderCount: 1,
          txHashes: [txHash("02").toUpperCase().replace("0X", "0x")],
        },
      ],
    }),
  ).toBe(txHash("02"));
  expect(
    testerOrderCreatedTxHash({
      testerOrderEvidence: [
        { outcome: TESTER_ORDER_CREATED, orderCount: 1, txHashes: [txHash("02")] },
        { outcome: TESTER_ORDER_CREATED, orderCount: 1, txHashes: [txHash("03")] },
      ],
    }),
  ).toBeUndefined();
  expect(testerOrderCreatedTxHash(undefined)).toBeUndefined();
});

it("uses legacy built state outpoints when decision outpoints are absent", () => {
  const state = createBotEventScanState(0);

  consumeBotEventText(
    state,
    `${JSON.stringify(
      botEvent(BOT_TRANSACTION_BUILT_EVENT, {
        actions: { matchedOrders: 1 },
        match: { matchedOrderOutPoints: [{ txHash: txHash("ba"), index: "0" }] },
      }),
    )}\n${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED_EVENT, { txHash: txHash("ca") }))}\n`,
    10,
  );

  expect(state.match?.matchedOrderOutPoints).toEqual([
    { txHash: txHash("ba"), index: "0" },
  ]);
});

it("validates preflight balance selection inputs and explicit scenarios", () => {
  expect(
    chooseLiveBotStimulus({
      tester: balances({
        depositCapacity: 1_000n * ckb,
        projectedCkb: 2_100n * ckb,
        ickbAvailable: 100n * ckb,
      }),
      requestedScenario: "bounded-ickb-to-ckb-limit-order",
    }),
  ).toMatchObject({
    scenario: "bounded-ickb-to-ckb-limit-order",
    testerFee: "1",
    testerFeeBase: "1000",
  });
});

it("validates CKB preflight selection inputs and explicit scenarios", () => {
  expect(
    chooseLiveBotStimulus({
      tester: balances({
        projectedCkb: 2_100n * ckb,
        ickbAvailable: 100n * ckb,
      }),
      requestedScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    }),
  ).toMatchObject({ scenario: ALL_CKB_LIMIT_ORDER_SCENARIO });
  expect(() =>
    chooseLiveBotStimulus({
      tester: balances({
        projectedCkb: 2_000n * ckb,
        ickbAvailable: 100n * ckb,
      }),
      requestedScenario: ALL_CKB_LIMIT_ORDER_SCENARIO,
    }),
  ).toThrow(`Explicit tester scenario ${ALL_CKB_LIMIT_ORDER_SCENARIO} is not fundable`);
  expect(
    chooseLiveBotStimulus({
      tester: balances({
        depositCapacity: 1_000n * ckb,
        projectedCkb: 4_001n * ckb,
      }),
      requestedScenario: EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
    }),
  ).toMatchObject({ scenario: EXTRA_LARGE_LIMIT_ORDER_SCENARIO });
  expect(
    chooseLiveBotStimulus({
      tester: balances({
        projectedCkb: 3_001n * ckb,
        feeRate: 0n,
      }),
      requestedScenario: "auto",
    }),
  ).toMatchObject({ scenario: ALL_CKB_LIMIT_ORDER_SCENARIO });
  expect(() =>
    chooseLiveBotStimulus({
      tester: balances({
        projectedCkb: 3_001n * ckb,
        feeRate: 1n,
      }),
      requestedScenario: "auto",
      testerFee: "0",
      testerFeeBase: "1",
    }),
  ).toThrow("No tester stimulus is currently fundable");
});

it("validates preflight balance parsing inputs", () => {
  expect(() =>
    balancesFromPreflight({ balances: { CKB: { available: "1.123456789" } } }),
  ).toThrow(MISSING_PUBLIC_BALANCES);
  expect(() => balancesFromPreflight({ balances: { CKB: {}, ICKB: {} } })).toThrow(
    MISSING_PUBLIC_BALANCES,
  );
  expect(
    balancesFromPreflight({
      balances: {
        CKB: { available: "3", projectedAvailable: "4" },
        ICKB: { available: "1" },
      },
      capital: { depositCapacity: "5" },
      system: { feeRate: "0" },
    }),
  ).toEqual({
    depositCapacity: 5n * ckb,
    projectedCkb: 4n * ckb,
    ickbAvailable: ckb,
    feeRate: 0n,
  });
  expect(() => {
    assertUnboundedBotLivePreflight({ bounded: true });
  }).toThrow("requires unbounded");
});
