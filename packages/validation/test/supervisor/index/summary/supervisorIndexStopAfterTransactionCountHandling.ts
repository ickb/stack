import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  CKB_TO_ICKB_DIRECTION,
  DETERMINISTIC_INCIDENT_SUITE,
  DUST_AMOUNT,
  DUST_CKB_CONVERSION_SCENARIO,
  FRESH_MATCHABLE_ORDER,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  STOP_AFTER_TX_COUNT_FLAG,
  SUMMARY_TX_HASHES,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TESTER_ONLY_SCENARIO,
  TESTER_SCENARIO_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  expectNoIncident,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  readArtifacts,
  recordAt,
  resolveTestPlan,
  spawnFixture,
  testerOrderStdout,
  testerSkipStdout,
  txHash,
} from "../../support/supervisor/index.ts";

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("treats stop-after-tx-count as a successful operator stop", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/stop-after-tx-test",
      SCENARIO_FLAG,
      TESTER_ONLY_SCENARIO,
      TARGET_OUTCOME_FLAG,
      "tester_fresh_order_skip",
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
          : fakeChild(testerOrderStdout({ txByte: "44" })),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expectNoIncident(writes);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/stop-after-tx-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
      testerOrderEvidence: [
        {
          outcome: "tester_order_created",
          txHashes: [txHash("44")],
          orderCount: 1,
          cancelledOrders: 0,
          orders: [
            {
              direction: CKB_TO_ICKB_DIRECTION,
              giveCkb: "10",
              takeIckb: "9",
              fee: "0.1",
              dust: false,
            },
          ],
        },
      ],
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("stops on dust tester txs without satisfying non-dust order targets", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/dust-order-target-test",
      SCENARIO_FLAG,
      TESTER_ONLY_SCENARIO,
      TARGET_OUTCOME_FLAG,
      "tester_order_created",
      TESTER_SCENARIO_FLAG,
      DUST_CKB_CONVERSION_SCENARIO,
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
              testerOrderStdout({
                txByte: "82",
                scenario: DUST_CKB_CONVERSION_SCENARIO,
                order: { giveCkb: DUST_AMOUNT, takeIckb: DUST_AMOUNT, fee: "0" },
              }),
            ),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/dust-order-target-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      requestedOutcomes: ["tester_order_created"],
      txCreatingTxHashCount: 1,
      txCreatingUniqueTxHashCount: 1,
      txCreatingOutcomeCount: 1,
      aggregateCounts: { tester_dust_order_created: 1 },
      testerOrderEvidence: [
        {
          outcome: "tester_dust_order_created",
          txHashes: [txHash("82")],
          orderCount: 1,
          cancelledOrders: 0,
          orders: [
            {
              direction: CKB_TO_ICKB_DIRECTION,
              giveCkb: DUST_AMOUNT,
              takeIckb: DUST_AMOUNT,
              fee: "0",
              dust: true,
            },
          ],
        },
      ],
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("does not count skip reference hashes toward stop-after-tx-count", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/skip-hash-stop-test",
      SCENARIO_FLAG,
      TESTER_ONLY_SCENARIO,
      TARGET_OUTCOME_FLAG,
      "tester_fresh_order_skip",
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
          : fakeChild(testerSkipStdout(FRESH_MATCHABLE_ORDER, "44")),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/skip-hash-stop-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "max_cycles",
      txCreatingTxHashCount: 0,
      txCreatingUniqueTxHashCount: 0,
      txCreatingOutcomeCount: 0,
    });
    expect(recordAt(summary.txHashesByOutcome, SUMMARY_TX_HASHES)).toEqual({
      tester_fresh_order_skip: [txHash("44")],
    });
    expect(recordAt(summary.uniqueTxHashesByOutcome, "summary unique tx hashes")).toEqual(
      {
        tester_fresh_order_skip: [txHash("44")],
      },
    );
  });
});
