import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_PATH,
  BOT_DECISION_SKIPPED,
  BOT_TRANSACTION_FAILED,
  DETERMINISTIC_INCIDENT_SUITE,
  FRESH_MATCHABLE_ORDER,
  FRESH_SKIP_TWO_PASS_SCENARIO,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  STOP_AFTER_TX_COUNT_FLAG,
  SUMMARY_AGGREGATE_COUNTS,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  emptyActions,
  expectedTesterPreflightState,
  fakeChild,
  fakePreflightChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  readArtifacts,
  recordAt,
  resolveTestPlan,
  safePreflightBalances,
  selectiveIgnoredChecker,
  spawnFixture,
  stringifyJsonLine,
  testerOrderStdout,
  testerSkipStdout,
  txHash,
} from "../../support/supervisor/index.ts";

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("summarizes retryable bot failures hidden by later skips", async () => {
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/retryable-failure-summary-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/retryable-failure-summary-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    const stdout = [
      botEvent(BOT_TRANSACTION_FAILED, {
        iterationId: 1,
        phase: "broadcast",
        outcome: "send_failed",
        retryable: true,
        terminal: false,
        error: {
          name: "Error",
          code: -301,
          outPoint: { txHash: txHash("92"), index: "0" },
          message: "resolve failed",
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

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(stdout),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/retryable-failure-summary-test/summary.json",
    );
    expect(recordAt(summary.aggregateCounts, SUMMARY_AGGREGATE_COUNTS)).toEqual({
      bot_no_action_skip: 1,
    });
    expect(summary.retryableFailures).toEqual([
      {
        actor: "bot",
        type: BOT_TRANSACTION_FAILED,
        iterationId: 1,
        phase: "broadcast",
        outcome: "send_failed",
        errorName: "Error",
        errorCode: -301,
        outPoint: { txHash: txHash("92"), index: "0" },
      },
    ]);
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("summarizes safe preflight balances and selected tester scenario", async () => {
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/preflight-state-summary-test",
      SCENARIO_FLAG,
      FRESH_SKIP_TWO_PASS_SCENARIO,
      TARGET_OUTCOME_FLAG,
      "tester_order_created",
      STOP_AFTER_TX_COUNT_FLAG,
      "1",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/preflight-state-summary-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });

    let testerRuns = 0;
    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakePreflightChild({
            ...safePreflightBalances(),
          });
        }
        testerRuns += 1;
        return fakeChild(
          testerRuns === 1
            ? testerOrderStdout({
                txByte: "81",
                order: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
              })
            : testerSkipStdout(FRESH_MATCHABLE_ORDER, "81"),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/preflight-state-summary-test/summary.json",
    );
    expect(summary.preflightState).toEqual([
      expectedTesterPreflightState("tester-pass-1"),
      expectedTesterPreflightState("tester-pass-2"),
    ]);
  });
});
