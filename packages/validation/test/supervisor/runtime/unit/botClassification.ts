import { expect, it } from "vitest";

import {
  classifyActorResult,
  classifyBotCommit,
  classifyBotResult,
  classifyBotSkip,
  classifyRelevantBotTransactionFailure,
} from "../../../../src/supervisor/index.ts";
import { recordActorClassification } from "../../../../src/supervisor/runtime/actor/supervisorActorState.ts";
import {
  BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED,
  botActions,
  botEvent,
  botStateReadEvent,
  stringifyJsonLine,
  txHash,
} from "../../support/supervisor/index.ts";
import { classificationBase, commandResult, runState, sparseRecords } from "./support.ts";

const INVALID_ACTION_COUNT_REASON = "bot action count evidence contained invalid count";

it("covers bot result classification fallbacks", () => {
  const base = classificationBase("bot");

  expect(
    classifyBotResult(
      commandResult("bot", ""),
      { records: [], ignoredLines: [], malformedLines: [] },
      base,
    ),
  ).toMatchObject({
    outcome: "unknown",
    terminal: true,
  });
  expect(
    classifyBotResult(
      commandResult("bot", "", { status: 3 }),
      {
        records: [{ txHash: txHash("aa"), error: { txHash: txHash("bb") } }],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "nonzero_exit", txHashes: [] });
  expect(
    classifyBotResult(
      commandResult("bot", ""),
      {
        records: [
          botEvent("bot.iteration.failed", {
            terminal: true,
            retryable: false,
          }),
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({
    outcome: "bot_terminal_error",
    reason: "bot reported terminal iteration failure",
  });
  expect(
    classifyBotResult(
      commandResult("bot", ""),
      {
        records: [botEvent("bot.iteration.failed", { terminal: true })],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "unknown" });
});

it("covers bot skip malformed branches", () => {
  const base = classificationBase("bot");

  expect(classifyBotSkip(undefined, base, undefined, undefined)).toBeUndefined();
  expect(
    classifyBotSkip(
      { reason: "post_tx_ckb_reserve", txHash: txHash("01") },
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "bot_reserve_skip" });
  expect(
    classifyBotSkip(
      { reason: "no_actions", txHash: txHash("01"), error: { txHash: txHash("02") } },
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
  expect(
    classifyBotResult(
      commandResult("bot", ""),
      {
        records: [
          botEvent("bot.decision.skipped", {
            reason: "capital_below_minimum",
            txHash: txHash("01"),
            error: { txHash: txHash("02") },
          }),
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
  expect(
    classifyBotResult(
      commandResult("bot", ""),
      {
        records: [
          botEvent("bot.decision.skipped", {
            reason: "capital_below_minimum",
            txHash: txHash("03"),
            actions: { deposits: -1 },
          }),
        ],
        ignoredLines: [],
        malformedLines: [],
      },
      base,
    ),
  ).toMatchObject({
    outcome: "malformed_evidence",
    reason: INVALID_ACTION_COUNT_REASON,
  });
  expect(classifyBotSkip({ actions: {} }, base, undefined, undefined)).toMatchObject({
    outcome: "bot_no_action_skip",
    skipReason: "unknown",
  });
});

it("covers bot commit edge cases", () => {
  const base = classificationBase("bot");
  const mismatchedCommit = classifyBotCommit(
    { txHash: txHash("01"), error: { txHash: txHash("02") } },
    0,
    [],
    base,
    undefined,
    undefined,
  );
  expect(mismatchedCommit).toMatchObject({ outcome: "malformed_evidence" });
  expect(mismatchedCommit.reason).toContain("mismatched");
  const stateRead = botStateReadEvent();
  expect(
    classifyBotCommit(
      botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("09") }),
      2,
      [
        stateRead,
        botEvent(BOT_TRANSACTION_BUILT, {
          actions: { deposits: 1 },
          decision: { balances: stateRead["balances"] },
        }),
        botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("09") }),
      ],
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "bot_deposit_only_committed" });
  expect(
    classifyBotSkip({ actions: { deposits: -1 } }, base, undefined, undefined),
  ).toMatchObject({
    outcome: "malformed_evidence",
    reason: INVALID_ACTION_COUNT_REASON,
  });
  const fractionalActionCommit = botEvent(BOT_TRANSACTION_COMMITTED, {
    txHash: txHash("08"),
  });
  expect(
    classifyBotCommit(
      fractionalActionCommit,
      1,
      [
        botEvent(BOT_TRANSACTION_BUILT, {
          actions: { deposits: 0.5 },
        }),
        fractionalActionCommit,
      ],
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({
    outcome: "malformed_evidence",
    reason: INVALID_ACTION_COUNT_REASON,
  });
  expect(
    classifyBotCommit(
      botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash("03") }),
      0,
      sparseRecords(),
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
});

it("covers bot transaction failure edge cases", () => {
  const base = classificationBase("bot");

  expect(
    classifyRelevantBotTransactionFailure(undefined, base, undefined, undefined),
  ).toBeUndefined();
  expect(
    classifyRelevantBotTransactionFailure(
      {
        phase: "broadcast",
        outcome: "send_failed",
        retryable: true,
        terminal: false,
      },
      base,
      undefined,
      undefined,
    ),
  ).toBeUndefined();
  expect(
    classifyRelevantBotTransactionFailure(
      {
        phase: "broadcast",
        outcome: "send_failed",
        retryable: false,
        terminal: true,
        txHash: txHash("04"),
        error: { txHash: txHash("05") },
      },
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "malformed_evidence" });
  expect(
    classifyRelevantBotTransactionFailure(
      {
        phase: "confirmation",
        outcome: "confirmation_failed",
        status: "unresolved",
        txHash: txHash("06"),
      },
      base,
      undefined,
      undefined,
    ),
  ).toMatchObject({ outcome: "post_broadcast_unresolved" });
});

it("keeps terminal infrastructure failures after they satisfy pending balance audit", () => {
  const state = runState();
  Object.assign(state, {
    pendingBotBalanceAudit: {
      kind: "commit",
      txHashes: [txHash("07")],
      actions: botActions({ matchedOrders: 1 }),
    },
  });
  const classification = classifyActorResult(
    "bot",
    commandResult("bot", stringifyJsonLine(botStateReadEvent()), { timedOut: true }),
  );

  const recorded = recordActorClassification(state, classification);

  expect(recorded).toMatchObject({ outcome: "command_timeout", terminal: true });
  expect(state.pendingBotBalanceAudit).toBeUndefined();
});
