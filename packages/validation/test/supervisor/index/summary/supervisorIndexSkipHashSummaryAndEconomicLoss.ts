import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  DETERMINISTIC_INCIDENT_SUITE,
  FRESH_MATCHABLE_ORDER,
  INCIDENT_CLASSIFICATION,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  STOP_AFTER_TX_COUNT_FLAG,
  SUMMARY_TX_HASHES,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TESTER_ONLY_SCENARIO,
  TEST_ACTOR_ENTRYPOINTS,
  botActions,
  botCommitStdout,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  profitableBotMatchDecision,
  readArtifacts,
  recordAt,
  resolveTestPlan,
  spawnFixture,
  testerSkipStdout,
  txHash,
} from "../../support/supervisor/index.ts";

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("summarizes repeated skip reference hashes separately from unique hashes", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/repeated-skip-hash-summary-test",
      SCENARIO_FLAG,
      TESTER_ONLY_SCENARIO,
      TARGET_OUTCOME_FLAG,
      "tester_fresh_order_skip",
      MAX_CYCLES_FLAG,
      "2",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(testerSkipStdout(FRESH_MATCHABLE_ORDER, "45")),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/repeated-skip-hash-summary-test/summary.json",
    );
    expect(recordAt(summary.txHashesByOutcome, SUMMARY_TX_HASHES)).toEqual({
      tester_fresh_order_skip: [txHash("45"), txHash("45")],
    });
    expect(recordAt(summary.uniqueTxHashesByOutcome, "summary unique tx hashes")).toEqual(
      {
        tester_fresh_order_skip: [txHash("45")],
      },
    );
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("counts matching top-level and nested transaction hashes once in summaries", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/dedup-tx-hash-summary-test",
      SCENARIO_FLAG,
      "bot-only",
      STOP_AFTER_TX_COUNT_FLAG,
      "1",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
              botCommitStdout({
                txByte: "5c",
                actions: botActions({ matchedOrders: 1 }),
                decision: profitableBotMatchDecision(),
                extraCommit: { error: { txHash: txHash("5c") } },
              }),
            ),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/dedup-tx-hash-summary-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
    });
    expect(recordAt(summary.txHashesByOutcome, SUMMARY_TX_HASHES)).toEqual({
      bot_match_committed: [txHash("5c")],
    });
    expect(summary.aggregateCounts).toEqual({ bot_match_committed: 1 });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("stops live supervisor chunks on bot economic loss", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-economic-loss-test",
      SCENARIO_FLAG,
      "bot-only",
      STOP_AFTER_TX_COUNT_FLAG,
      "1",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
              botCommitStdout({
                txByte: "61",
                actions: botActions({ matchedOrders: 1 }),
                decision: {
                  match: { value: "999" },
                  fee: { estimated: "10" },
                  exchangeRatio: { ckbScale: "100" },
                },
              }),
            ),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-economic-loss-test/cycle-0001-incident.json",
    );
    expect(recordAt(incident.classification, INCIDENT_CLASSIFICATION)).toMatchObject({
      outcome: "economic_loss",
      terminal: true,
      txHashes: [txHash("61")],
    });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-economic-loss-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "economic_loss",
      aggregateCounts: { economic_loss: 1 },
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
    });
  });
});
