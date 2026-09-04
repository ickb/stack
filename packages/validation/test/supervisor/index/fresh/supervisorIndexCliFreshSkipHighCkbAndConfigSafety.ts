import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOUNDED_ICKB_TO_CKB_SCENARIO,
  FRESH_MATCHABLE_ORDER,
  FRESH_SKIP_TWO_PASS_SCENARIO,
  LIVE_SUPERVISOR_TEST_DIR,
  MAX_CYCLES_FLAG,
  MULTI_ORDER_SCENARIO,
  PREFLIGHT_CKB_AVAILABLE,
  PREFLIGHT_ICKB_AVAILABLE,
  RANDOM_ORDER_SCENARIO,
  SCENARIO_FLAG,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TESTER_ENTRYPOINT,
  TESTER_OWNED_TX_HASH_FLAG,
  TESTER_SCENARIO_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  fakeChild,
  fakePreflightChild,
  fakeSuccessfulPreflightChild,
  freshSkipTwoPassStdout,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  runSupervisorFixture,
  selectiveIgnoredChecker,
  txHash,
} from "../../support/supervisor/index.ts";

const { join } = path;

describe(SUPERVISOR_CLI_SUITE, () => {
  it("uses raw-order first-pass fresh-skip stimulus when plain CKB is high", async () => {
    let testerRuns = 0;
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-high-ckb-test",
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
                ckbAvailable: "3000",
                ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
              })
            : fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(freshSkipTwoPassStdout(testerRuns, "80"));
      },
    );

    const testerSpawns = spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(testerSpawns.map(({ args }) => args)).toEqual([
      [TESTER_ENTRYPOINT],
      [TESTER_ENTRYPOINT, TESTER_OWNED_TX_HASH_FLAG, txHash("80")],
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
  it.each([
    {
      kind: "missing hash",
      pass2Stdout: JSON.stringify({ skip: { reason: FRESH_MATCHABLE_ORDER } }),
    },
    {
      kind: "mismatched hash",
      pass2Stdout: JSON.stringify({
        skip: { reason: FRESH_MATCHABLE_ORDER, txHash: txHash("81") },
      }),
    },
  ])("fails closed on pass-two $kind provenance", async ({ pass2Stdout }) => {
    let testerRuns = 0;
    const { exitCode, spawned, writes } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-invalid-provenance-test",
        SCENARIO_FLAG,
        FRESH_SKIP_TWO_PASS_SCENARIO,
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        testerRuns += 1;
        return fakeChild(
          testerRuns === 1 ? freshSkipTwoPassStdout(1, "80") : pass2Stdout,
        );
      },
    );

    const testerSpawns = spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(2);
    expect(testerSpawns[1]?.args).toEqual([
      TESTER_ENTRYPOINT,
      TESTER_OWNED_TX_HASH_FLAG,
      txHash("80"),
    ]);
    expect([...writes.values()].join("\n")).toContain('"outcome":"malformed_evidence"');
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it.each([
    ["missing", JSON.stringify({ skip: { reason: "post-tx-ckb-reserve" } })],
    [
      "duplicate",
      [pass1OrderStdout(txHash("80")), pass1OrderStdout(txHash("81"))].join("\n"),
    ],
    ["malformed grammar", pass1OrderStdout("not-a-tx-hash")],
    ["malformed type", pass1OrderStdout(7)],
    ["mismatched", pass1OrderStdout(txHash("80"), { error: { txHash: txHash("81") } })],
  ])("stops before pass two on $0 pass-one provenance", async (_kind, pass1Stdout) => {
    const outDir = "log/live-supervisor/two-pass-invalid-pass-one-test";
    const { exitCode, spawned, writes } = await runSupervisorFixture(
      ["--out-dir", outDir, SCENARIO_FLAG, FRESH_SKIP_TWO_PASS_SCENARIO],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(pass1Stdout),
    );

    expect(exitCode).toBe(2);
    expect(spawned.filter((item) => item.args[0] === TESTER_ENTRYPOINT)).toHaveLength(1);
    const incident = jsonArtifact(writes, `/repo/${outDir}/cycle-0001-incident.json`);
    expect(incident).toMatchObject({
      actor: "tester",
      command: { command: "node", args: [TESTER_ENTRYPOINT] },
      exit: { status: 0 },
      classification: { outcome: "malformed_evidence", terminal: true },
      stdoutExcerpt: `${pass1Stdout}\n`,
    });
    expect(incident.artifacts).toEqual(
      expect.arrayContaining([
        `${outDir}/cycle-0001-tester-pass-1.stdout.ndjson`,
        `${outDir}/cycle-0001-tester-pass-1.command.json`,
      ]),
    );
    expect(jsonArtifact(writes, `/repo/${outDir}/summary.json`)).toMatchObject({
      stopped: "malformed_evidence",
      aggregateCounts: { malformed_evidence: 1 },
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects external passthrough of tester-owned provenance", () => {
    expect(() => parseArgs([TESTER_OWNED_TX_HASH_FLAG, txHash("80")])).toThrow(
      `Unknown argument: ${TESTER_OWNED_TX_HASH_FLAG}`,
    );
  });

  it("preserves explicit tester scenario during fresh-skip pass selection", async () => {
    const { spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/two-pass-explicit-test",
        SCENARIO_FLAG,
        FRESH_SKIP_TWO_PASS_SCENARIO,
        TESTER_SCENARIO_FLAG,
        MULTI_ORDER_SCENARIO,
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakePreflightChild({
              ckbAvailable: PREFLIGHT_CKB_AVAILABLE,
              ickbAvailable: PREFLIGHT_ICKB_AVAILABLE,
            })
          : fakeChild(
              JSON.stringify({
                startTime: "now",
                actions: {
                  requestedTesterScenario: "auto",
                  testerScenario: BOUNDED_ICKB_TO_CKB_SCENARIO,
                  newOrder: { giveIckb: "20", takeCkb: "18", fee: "0.2" },
                  cancelledOrders: 0,
                },
                txHash: txHash("79"),
                ElapsedSeconds: 1,
              }),
            ),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: MULTI_ORDER_SCENARIO,
    });
  });
});

function pass1OrderStdout(
  txHashValue: unknown,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    actions: {
      testerScenario: RANDOM_ORDER_SCENARIO,
      newOrder: { giveCkb: "10", takeIckb: "9", fee: "0.1" },
    },
    txHash: txHashValue,
    ...extra,
  });
}

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses live config paths through symlinked parents", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "ickb-supervisor-config-root-"));
    const configTarget = await mkdtemp(join(tmpdir(), "ickb-supervisor-config-target-"));
    await symlink(configTarget, join(rootDir, "config"));
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/config-symlink-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolvePlan(args, rootDir, {
      spawnSyncCommand: ignoredChecker(true),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        spawnSyncCommand: ignoredChecker(true),
      }),
    ).rejects.toThrow("Refusing to use bot config path through symlinked path: config");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses non-ignored config paths", () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      "tracked-bot.json",
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      LIVE_SUPERVISOR_TEST_DIR,
    ]);

    expect(() =>
      resolvePlan(args, "/repo", {
        spawnSyncCommand: selectiveIgnoredChecker(
          new Set([LIVE_SUPERVISOR_TEST_DIR, TESTER_CONFIG_PATH]),
        ),
      }),
    ).toThrow("Refusing to use non-ignored Bot config path: tracked-bot.json");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses non-ignored default config paths", () => {
    const args = parseArgs(["--out-dir", LIVE_SUPERVISOR_TEST_DIR]);

    expect(() =>
      resolvePlan(args, "/repo", {
        spawnSyncCommand: selectiveIgnoredChecker(
          new Set([LIVE_SUPERVISOR_TEST_DIR, TESTER_CONFIG_PATH]),
        ),
      }),
    ).toThrow("Refusing to use non-ignored Bot config path: config/bot-testnet.json");
  });
});
