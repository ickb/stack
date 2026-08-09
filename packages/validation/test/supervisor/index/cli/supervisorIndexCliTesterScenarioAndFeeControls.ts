import { describe, expect, it } from "vitest";
import {
  BOT_ENTRYPOINT,
  FRESH_SKIP_TWO_PASS_SCENARIO,
  MAX_CYCLES_FLAG,
  RANDOM_ORDER_SCENARIO,
  SCENARIO_FLAG,
  STANDARD_CYCLE_SCENARIO,
  SUMMARY_AGGREGATE_COUNTS,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TESTER_ENTRYPOINT,
  TESTER_FEE_BASE_FLAG,
  TESTER_FEE_FLAG,
  TESTER_SCENARIO_FLAG,
  botNoActionStdout,
  fakeChild,
  fakeSuccessfulPreflightChild,
  freshSkipTwoPassStdout,
  isPreflightCommand,
  jsonArtifact,
  recordAt,
  runSupervisorFixture,
  testerOrderStdout,
  txHash,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("preserves explicit tester auto scenario over conversion target steering", async () => {
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/explicit-auto-env-test",
        TARGET_OUTCOME_FLAG,
        "tester_conversion_created",
        TESTER_SCENARIO_FLAG,
        "auto",
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
                  conversion: { kind: "direct" },
                  cancelledOrders: 0,
                },
                txHash: txHash("17"),
                ElapsedSeconds: 1,
              }),
            ),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({ TESTER_SCENARIO: "auto" });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("passes tester fee controls only to the tester actor", async () => {
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/tester-fee-env-test",
        SCENARIO_FLAG,
        STANDARD_CYCLE_SCENARIO,
        TESTER_FEE_FLAG,
        "1000",
        TESTER_FEE_BASE_FLAG,
        "100000",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        return fakeChild(
          commandArgs[0] === TESTER_ENTRYPOINT
            ? testerOrderStdout({ txByte: "18" })
            : botNoActionStdout(),
        );
      },
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    const bot = spawned.find((item) => item.args[0] === BOT_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({
      TESTER_FEE: "1000",
      TESTER_FEE_BASE: "100000",
    });
    expect(bot?.env).not.toHaveProperty("TESTER_FEE");
    expect(bot?.env).not.toHaveProperty("TESTER_FEE_BASE");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("runs the same tester twice for fresh-skip raw-order coverage", async () => {
    let testerRuns = 0;
    const { exitCode, spawned, writes } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-test",
        SCENARIO_FLAG,
        FRESH_SKIP_TWO_PASS_SCENARIO,
        TARGET_OUTCOME_FLAG,
        "tester_order_created",
        TARGET_OUTCOME_FLAG,
        "tester_fresh_order_skip",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(freshSkipTwoPassStdout(testerRuns, "77"));
      },
    );

    const testerSpawns = spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(testerSpawns).toHaveLength(2);
    expect(testerSpawns[0]?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
    expect(testerSpawns[1]?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
    expect(
      writes.has(
        "/repo/log/live-supervisor/two-pass-test/cycle-0001-tester-pass-1.stdout.ndjson",
      ),
    ).toBe(true);
    expect(
      writes.has(
        "/repo/log/live-supervisor/two-pass-test/cycle-0001-tester-pass-2.stdout.ndjson",
      ),
    ).toBe(true);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/two-pass-test/summary.json",
    );
    expect(recordAt(summary.aggregateCounts, SUMMARY_AGGREGATE_COUNTS)).toMatchObject({
      tester_order_created: 1,
      tester_fresh_order_skip: 1,
    });
  });
});
