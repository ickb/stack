import { describe, expect, it } from "vitest";
import {
  parseArgs,
  resolvePlan,
  supervise,
  usage,
} from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  BOT_MATCH_COMMITTED,
  BOUNDED_ICKB_TO_CKB_SCENARIO,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  DIRECTORY_STATS,
  EXTERNAL_VALIDATION_PARENT,
  EXTERNAL_VALIDATION_RUN_DIR,
  FRESH_SKIP_TWO_PASS_SCENARIO,
  INVALID_OUT_DIR_MESSAGE,
  LIVE_SUPERVISOR_TEST_DIR,
  MAX_CYCLES_FLAG,
  MIXED_DIRECTION_SCENARIO,
  MULTI_ORDER_SCENARIO,
  SCENARIO_FLAG,
  SDK_CONVERSION_SCENARIO,
  STOP_AFTER_TX_COUNT_FLAG,
  SUPERVISOR_CLI_SUITE,
  SYMBOLIC_LINK_STATS,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TESTER_FEE_BASE_FLAG,
  TESTER_FEE_FLAG,
  TESTER_SCENARIO_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  TWO_CKB_TO_ICKB_SCENARIO,
  TWO_ICKB_TO_CKB_SCENARIO,
  VALIDATION_RUN_DIR,
  ignoredChecker,
  lstatFixture,
  missingStat,
  noopAsync,
  pathToString,
  selectiveIgnoredChecker,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("parses bounded live supervisor arguments", () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      MAX_CYCLES_FLAG,
      "3",
      STOP_AFTER_TX_COUNT_FLAG,
      "2",
      SCENARIO_FLAG,
      FRESH_SKIP_TWO_PASS_SCENARIO,
      TESTER_SCENARIO_FLAG,
      "all-ckb-limit-order",
      TESTER_FEE_FLAG,
      "1000",
      TESTER_FEE_BASE_FLAG,
      "100000",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      TARGET_OUTCOME_FLAG,
      "bot_no_action_skip",
    ]);

    expect(args.botConfigPath).toBe(BOT_CONFIG_PATH);
    expect(args.testerConfigPath).toBe(TESTER_CONFIG_PATH);
    expect(args.maxCycles).toBe(3);
    expect(args.stopAfterTxCount).toBe(2);
    expect(args.scenario).toBe(FRESH_SKIP_TWO_PASS_SCENARIO);
    expect(args.testerScenario).toBe("all-ckb-limit-order");
    expect(args.testerFee).toBe("1000");
    expect(args.testerFeeBase).toBe("100000");
    expect(args.targetOutcomes).toEqual([BOT_MATCH_COMMITTED, "bot_no_action_skip"]);
    expect(usage()).toContain(BOT_CONFIG_FLAG);
    expect(usage()).toContain(SDK_CONVERSION_SCENARIO);
    expect(usage()).toContain(FRESH_SKIP_TWO_PASS_SCENARIO);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("parses the SDK conversion tester scenario", () => {
    const args = parseArgs([TESTER_SCENARIO_FLAG, SDK_CONVERSION_SCENARIO]);

    expect(args.testerScenario).toBe(SDK_CONVERSION_SCENARIO);
    expect(
      parseArgs([TESTER_SCENARIO_FLAG, TWO_CKB_TO_ICKB_SCENARIO]).testerScenario,
    ).toBe(TWO_CKB_TO_ICKB_SCENARIO);
    expect(
      parseArgs([TESTER_SCENARIO_FLAG, TWO_ICKB_TO_CKB_SCENARIO]).testerScenario,
    ).toBe(TWO_ICKB_TO_CKB_SCENARIO);
    expect(
      parseArgs([TESTER_SCENARIO_FLAG, BOUNDED_ICKB_TO_CKB_SCENARIO]).testerScenario,
    ).toBe(BOUNDED_ICKB_TO_CKB_SCENARIO);
    expect(
      parseArgs([TESTER_SCENARIO_FLAG, MIXED_DIRECTION_SCENARIO]).testerScenario,
    ).toBe(MIXED_DIRECTION_SCENARIO);
    expect(parseArgs([TESTER_SCENARIO_FLAG, MULTI_ORDER_SCENARIO]).testerScenario).toBe(
      MULTI_ORDER_SCENARIO,
    );
    expect(() => parseArgs([TESTER_SCENARIO_FLAG, "interface-like"])).toThrow(
      "Invalid --tester-scenario",
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects malformed tester fee controls", () => {
    expect(() => parseArgs([TESTER_FEE_FLAG, "1.5"])).toThrow("Invalid --tester-fee");
    expect(() => parseArgs([TESTER_FEE_BASE_FLAG, "-1"])).toThrow(
      "Invalid --tester-fee-base",
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects unsafe integer bounds without numeric rounding", () => {
    expect(parseArgs([MAX_CYCLES_FLAG, String(Number.MAX_SAFE_INTEGER)]).maxCycles).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(() => parseArgs([MAX_CYCLES_FLAG, "9007199254740992"])).toThrow(
      "Invalid --max-cycles: expected a safe integer",
    );
    expect(() => parseArgs([COMMAND_TIMEOUT_SECONDS_FLAG, "9007199254740993"])).toThrow(
      "Invalid --command-timeout-seconds: expected a safe integer",
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("defaults bare supervisor runs to deterministic live configs", () => {
    const args = parseArgs([]);

    expect(args.botConfigPath).toBe(BOT_CONFIG_PATH);
    expect(args.testerConfigPath).toBe(TESTER_CONFIG_PATH);
    expect(args.testerScenario).toBeUndefined();
    expect(args.testerFee).toBeUndefined();
    expect(args.testerFeeBase).toBeUndefined();
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses non-ignored output paths", () => {
    const args = parseArgs(["--out-dir", "not-ignored"]);

    expect(() =>
      resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) }),
    ).toThrow(INVALID_OUT_DIR_MESSAGE);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses non-ignored output paths under the supervisor artifact root", () => {
    const args = parseArgs(["--out-dir", "log/live-supervisor/tracked"]);

    expect(() =>
      resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(false) }),
    ).toThrow("Refusing to write non-ignored supervisor output directory");
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses ignored output paths outside the supervisor artifact root", () => {
    const args = parseArgs(["--out-dir", "config/supervisor"]);

    expect(() =>
      resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) }),
    ).toThrow(INVALID_OUT_DIR_MESSAGE);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("resolves ignored artifact paths with the default configs", () => {
    const args = parseArgs(["--out-dir", LIVE_SUPERVISOR_TEST_DIR]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: ignoredChecker(true),
    });

    expect(plan.relativeOutDir).toBe(LIVE_SUPERVISOR_TEST_DIR);
    expect(plan.botConfigPath).toBe(`/repo/${BOT_CONFIG_PATH}`);
    expect(plan.testerConfigPath).toBe(`/repo/${TESTER_CONFIG_PATH}`);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("accepts dynamic validation session artifact paths", () => {
    const args = parseArgs(["--out-dir", VALIDATION_RUN_DIR]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([VALIDATION_RUN_DIR, BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
      ),
    });

    expect(plan.relativeOutDir).toBe(VALIDATION_RUN_DIR);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects validation roots outside run artifact directories", () => {
    const args = parseArgs(["--out-dir", "log/validation/dynamic-test"]);

    expect(() =>
      resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) }),
    ).toThrow(INVALID_OUT_DIR_MESSAGE);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("rejects validation run artifact directory descendants", () => {
    const args = parseArgs([
      "--out-dir",
      "log/validation/dynamic-test/chunks/chunk-0001/run-0001/extra",
    ]);

    expect(() =>
      resolvePlan(args, "/repo", { spawnSyncCommand: ignoredChecker(true) }),
    ).toThrow(INVALID_OUT_DIR_MESSAGE);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("accepts explicit validation session roots outside the repo", () => {
    const args = parseArgs(["--out-dir", EXTERNAL_VALIDATION_RUN_DIR]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
      ),
    });

    expect(plan.relativeOutDir).toBe(EXTERNAL_VALIDATION_RUN_DIR);
    expect(plan.outDir).toBe(EXTERNAL_VALIDATION_RUN_DIR);
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("refuses symlinked explicit validation parents outside the repo", async () => {
    const args = parseArgs(["--out-dir", EXTERNAL_VALIDATION_RUN_DIR]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
      ),
    });

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        skipBuiltRuntimeCheck: true,
        lstat: lstatFixture((path) =>
          pathToString(path) === EXTERNAL_VALIDATION_PARENT
            ? SYMBOLIC_LINK_STATS
            : DIRECTORY_STATS,
        ),
        stat: missingStat,
        mkdir: noopAsync,
      }),
    ).rejects.toThrow(
      `Refusing to write supervisor artifacts through symlinked path: ${EXTERNAL_VALIDATION_PARENT}`,
    );
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("resolves default ignored live config paths", () => {
    const plan = resolvePlan(
      parseArgs(["--out-dir", LIVE_SUPERVISOR_TEST_DIR]),
      "/repo",
      {
        spawnSyncCommand: selectiveIgnoredChecker(
          new Set([LIVE_SUPERVISOR_TEST_DIR, BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
        ),
      },
    );

    expect(plan.botConfigPath).toBe("/repo/config/bot-testnet.json");
    expect(plan.testerConfigPath).toBe("/repo/config/tester-testnet.json");
  });
});
