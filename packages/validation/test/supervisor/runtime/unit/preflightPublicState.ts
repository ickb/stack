import { expect, it } from "vitest";

import {
  booleanField,
  botNoActionReason,
  classifyPreflightResult,
  commandTimeoutOrStop,
  errorMessage,
  finishPreflightRun,
  latestPublicState,
  preflightStateSummary,
  retryPreflight,
  stringField,
  suggestedNextAction,
} from "../../../../src/supervisor/index.ts";
import { txHash } from "../../support/supervisor/index.ts";
import {
  asyncValue,
  classificationBase,
  commandResult,
  runState,
  sparseRecords,
  supervisorPlan,
} from "./support.ts";

it("covers preflight classification and finish helper edge branches", async () => {
  const preflightBase = classificationBase("preflight");
  expect(
    classifyPreflightResult(
      commandResult("preflight", "", { status: 1, stderr: "" }),
      { records: [], ignoredLines: [], malformedLines: [] },
      preflightBase,
    ),
  ).toMatchObject({
    reason: "preflight command exited nonzero",
  });
  expect(
    classifyPreflightResult(
      commandResult("preflight", "{}"),
      { records: [], ignoredLines: [], malformedLines: [] },
      preflightBase,
    ),
  ).toMatchObject({
    outcome: "malformed_evidence",
  });

  const state = runState();
  await expect(
    finishPreflightRun(
      1,
      "bot-only",
      { actor: "bot" },
      supervisorPlan(),
      state,
      { stop: 9 },
      {},
    ),
  ).resolves.toBe(9);
  await expect(
    finishPreflightRun(
      1,
      "bot-only",
      { actor: "bot" },
      supervisorPlan(),
      state,
      {
        result: commandResult("preflight", ""),
        classification: {
          ...classificationBase("preflight"),
          outcome: "unknown",
          terminal: false,
          reason: "test",
        },
      },
      {},
    ),
  ).resolves.toBeUndefined();
  await expect(
    retryPreflight(1, { actor: "bot" }, supervisorPlan(), state, asyncValue(7), 0, {}),
  ).resolves.toEqual({ stop: 7 });
  await expect(
    commandTimeoutOrStop(
      supervisorPlan(),
      0,
      { now: () => 2_000 },
      1,
      "stage",
      async (_cycleIndex, _stage, remainingWallClockMs) => {
        await Promise.resolve();
        expect(remainingWallClockMs).toBe(-2_000);
        return 2;
      },
    ),
  ).resolves.toEqual({ stop: 2 });
});

it("covers preflight public state balance helpers", () => {
  expect(
    preflightStateSummary(
      1,
      { actor: "tester" },
      supervisorPlan({ testerScenario: "sdk-conversion" }),
      {
        balances: { CKB: {}, ICKB: {} },
      },
    ),
  ).toMatchObject({ selectedTesterScenario: "sdk-conversion" });
  expect(
    preflightStateSummary(1, { actor: "tester" }, supervisorPlan(), {
      balances: { CKB: { available: "1" } },
    }),
  ).toMatchObject({ balances: { CKB: { available: "1" } } });
  expect(
    preflightStateSummary(1, { actor: "tester" }, supervisorPlan(), {
      balances: { ICKB: { available: "2" } },
    }),
  ).toMatchObject({ balances: { ICKB: { available: "2" } } });
  expect(
    preflightStateSummary(1, { actor: "bot" }, supervisorPlan(), {
      balances: { CKB: {}, ICKB: {} },
    }).balances,
  ).toBeUndefined();
});

it("covers public state recommendations and wait summary fallbacks", () => {
  expect(
    suggestedNextAction({
      ...classificationBase("bot"),
      outcome: "confirmation_timeout",
      terminal: true,
      reason: "test",
      txHashes: [txHash("01")],
    }),
  ).toContain("confirm the tx hash");
  expect(
    suggestedNextAction({
      ...classificationBase("tester"),
      outcome: "low_capital_stop",
      terminal: true,
      reason: "test",
    }),
  ).toContain("fund the supervised account");
  expect(botNoActionReason("no_actions", undefined)).toContain("no_actions");
  expect(
    botNoActionReason("no_actions", {
      rebalanceReason: "no_ready_deposits",
      readyPoolDepositCount: undefined,
    }),
  ).toContain("readyPoolDeposits=unknown");
  expect(latestPublicState(sparseRecords())).toBeUndefined();
  expect(
    latestPublicState([
      { type: "bot.state.read", orders: {}, poolDeposits: {} },
      { iterationId: 1 },
      { type: "bot.transaction.built" },
    ])?.marketOrderCount,
  ).toBeUndefined();
  expect(booleanField(undefined, "ok")).toBeUndefined();
  expect(stringField(undefined, "value")).toBeUndefined();
  expect(errorMessage("plain")).toBe("plain");
  expect(errorMessage({})).toBe("Unknown error");
});
