import { describe, expect, it } from "vitest";
import {
  FRESH_SKIP_TWO_PASS_SCENARIO,
  MAX_CYCLES_FLAG,
  POST_TX_CKB_RESERVE,
  PREFLIGHT_CKB_AVAILABLE,
  PREFLIGHT_ICKB_AVAILABLE,
  RANDOM_ORDER_SCENARIO,
  SCENARIO_FLAG,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TESTER_ENTRYPOINT,
  TESTER_OWNED_TX_HASH_FLAG,
  fakeChild,
  fakePreflightChild,
  fakeSuccessfulPreflightChild,
  freshSkipTwoPassStdout,
  isPreflightCommand,
  jsonArtifact,
  runSupervisorFixture,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("uses random raw orders for low-CKB first-pass fresh-skip fundability", async () => {
    let testerRuns = 0;
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-low-ckb-test",
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
          return commandArgs.includes("tester-pass-1-1")
            ? fakePreflightChild({
                ckbAvailable: PREFLIGHT_CKB_AVAILABLE,
                ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
              })
            : fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(freshSkipTwoPassStdout(testerRuns, "78"));
      },
    );

    const testerSpawns = spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(testerSpawns).toHaveLength(2);
    expect(testerSpawns[1]?.args).toEqual([
      TESTER_ENTRYPOINT,
      TESTER_OWNED_TX_HASH_FLAG,
      `0x${"78".repeat(32)}`,
    ]);
    expect(testerSpawns[0]?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
    expect(testerSpawns[1]?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("stops before pass two when first-pass reserve misses provide no provenance", async () => {
    const { exitCode, spawned, writes } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-bounded-reserve-test",
        SCENARIO_FLAG,
        FRESH_SKIP_TWO_PASS_SCENARIO,
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakePreflightChild({
              ckbAvailable: "2100",
              ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
            })
          : fakeChild(JSON.stringify({ skip: { reason: POST_TX_CKB_RESERVE } })),
    );

    const testerSpawns = spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(2);
    expect(testerSpawns.map(({ args }) => args)).toEqual([[TESTER_ENTRYPOINT]]);
    expect(testerSpawns[0]?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/two-pass-bounded-reserve-test/cycle-0001-incident.json",
    );
    expect(incident).toMatchObject({
      actor: "tester",
      command: { command: "node", args: [TESTER_ENTRYPOINT] },
      exit: { status: 0 },
      classification: { outcome: "malformed_evidence", terminal: true },
      stdoutExcerpt: `${JSON.stringify({ skip: { reason: POST_TX_CKB_RESERVE } })}\n`,
    });
    expect(incident.artifacts).toEqual(
      expect.arrayContaining([
        "log/live-supervisor/two-pass-bounded-reserve-test/cycle-0001-tester-pass-1.stdout.ndjson",
        "log/live-supervisor/two-pass-bounded-reserve-test/cycle-0001-tester-pass-1.command.json",
      ]),
    );
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/two-pass-bounded-reserve-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "malformed_evidence",
      aggregateCounts: { malformed_evidence: 1 },
      skipReasons: [POST_TX_CKB_RESERVE],
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("uses raw-order first-pass fresh-skip stimulus when plain CKB is very low", async () => {
    const { spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-low-reserve-test",
        SCENARIO_FLAG,
        FRESH_SKIP_TWO_PASS_SCENARIO,
        TARGET_OUTCOME_FLAG,
        "tester_order_created",
        TARGET_OUTCOME_FLAG,
        "tester_fresh_order_skip",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakePreflightChild({
              ckbAvailable: "1999.99999999",
              ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
            })
          : fakeChild(JSON.stringify({ skip: { reason: POST_TX_CKB_RESERVE } })),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
  });
});
