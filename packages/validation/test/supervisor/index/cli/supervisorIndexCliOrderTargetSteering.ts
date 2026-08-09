import { describe, expect, it } from "vitest";
import {
  BOT_MATCH_COMMITTED,
  ICKB_TO_CKB_SCENARIO,
  INCIDENT_CLASSIFICATION,
  MAX_CYCLES_FLAG,
  RANDOM_ORDER_SCENARIO,
  SCENARIO_FLAG,
  SDK_CONVERSION_SCENARIO,
  STANDARD_CYCLE_SCENARIO,
  STOP_AFTER_TX_COUNT_FLAG,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TESTER_ENTRYPOINT,
  TESTER_SCENARIO_FLAG,
  botActions,
  botCommitStdout,
  fakeChild,
  fakeSuccessfulPreflightChild,
  isPreflightCommand,
  jsonArtifact,
  profitableBotMatchDecision,
  recordAt,
  runSupervisorFixture,
  testerOrderStdout,
  txHash,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("steers bot match setup to a raw order builder", async () => {
    const { exitCode, spawned, writes } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/match-env-test",
        SCENARIO_FLAG,
        STANDARD_CYCLE_SCENARIO,
        TARGET_OUTCOME_FLAG,
        BOT_MATCH_COMMITTED,
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        const child =
          commandArgs[0] === TESTER_ENTRYPOINT
            ? testerOrderStdout({ txByte: "8c" })
            : botCommitStdout({
                txByte: "8d",
                actions: botActions({ matchedOrders: 1 }),
                decision: profitableBotMatchDecision(),
              });
        return fakeChild(child);
      },
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/match-env-test/summary.json",
    );
    const preflightState = summary.preflightState;
    if (!Array.isArray(preflightState)) {
      throw new TypeError("Expected preflight state array");
    }
    expect(preflightState[0]).toMatchObject({
      selectedTesterScenario: RANDOM_ORDER_SCENARIO,
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects direct conversions while targeting tester order coverage", async () => {
    const { exitCode, writes } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/order-target-conversion-test",
        TARGET_OUTCOME_FLAG,
        "tester_order_created",
        STOP_AFTER_TX_COUNT_FLAG,
        "1",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
              JSON.stringify({
                startTime: "now",
                actions: {
                  requestedTesterScenario: "auto",
                  testerScenario: SDK_CONVERSION_SCENARIO,
                  conversion: { kind: "direct" },
                  cancelledOrders: 0,
                },
                txHash: txHash("8b"),
                ElapsedSeconds: 1,
              }),
            ),
    );

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/order-target-conversion-test/cycle-0001-incident.json",
    );
    expect(recordAt(incident.classification, INCIDENT_CLASSIFICATION)).toMatchObject({
      outcome: "tester_deterministic_pre_broadcast_error",
      terminal: true,
      reason: "tester committed tx for scenario sdk-conversion, expected random-order",
    });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/order-target-conversion-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "tester_deterministic_pre_broadcast_error",
      txCreatingTxHashCount: 0,
      txCreatingOutcomeCount: 0,
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("preserves explicit tester scenario over conversion target steering", async () => {
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/explicit-tester-env-test",
        TARGET_OUTCOME_FLAG,
        "tester_conversion_created",
        TESTER_SCENARIO_FLAG,
        ICKB_TO_CKB_SCENARIO,
        STOP_AFTER_TX_COUNT_FLAG,
        "1",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
              JSON.stringify({
                startTime: "now",
                actions: {
                  testerScenario: ICKB_TO_CKB_SCENARIO,
                  newOrder: { giveIckb: "10", takeCkb: "9", fee: "0.1" },
                  cancelledOrders: 0,
                },
                txHash: txHash("16"),
                ElapsedSeconds: 1,
              }),
            ),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: ICKB_TO_CKB_SCENARIO,
    });
  });
});
