import assert from "node:assert/strict";
import test from "node:test";
import {
  type SpawnResultFixture,
  BETWEEN_CHUNKS_SECONDS_OPTION,
  CHILD_TIMEOUT_SECONDS_OPTION,
  CHUNK_BACKOFF_SECONDS_OPTION,
  CHUNK_MAX_RUNS_OPTION,
  CHUNK_TIMEOUT_SECONDS_OPTION,
  COMMAND_TIMEOUT_SECONDS_OPTION,
  DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  KEEP_GOING_OPTION,
  LOG_ROOT_OPTION,
  MAX_CHUNKS_OPTION,
  PREFLIGHT_SCRIPT_OPTION,
  PREFLIGHT_TIMEOUT_SECONDS_OPTION,
  REPO_SUPERVISOR_LOOP_SCRIPT,
  SESSION_ROOT_OPTION,
  STABLE_LIMIT_OPTION,
  SUPERVISOR_LOOP_SCRIPT_OPTION,
  TARGET_OUTCOME_OPTION,
  TESTER_CONFIG_OPTION,
  TESTER_SCENARIO_OPTION,
  at,
  parseArgs,
  runDynamicSupervisorLoop,
  testOutput,
  usage,
} from "./support.ts";

void test("dynamic supervisor loop parses options", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.deepEqual(
    parseArgs([
      TESTER_CONFIG_OPTION,
      "config/custom.json",
      LOG_ROOT_OPTION,
      "log/custom",
      SESSION_ROOT_OPTION,
      "log/custom/validation/manual-session",
      MAX_CHUNKS_OPTION,
      "2",
      CHUNK_MAX_RUNS_OPTION,
      "3",
      STABLE_LIMIT_OPTION,
      "99",
      CHUNK_BACKOFF_SECONDS_OPTION,
      "4",
      BETWEEN_CHUNKS_SECONDS_OPTION,
      "5",
      CHILD_TIMEOUT_SECONDS_OPTION,
      "102",
      COMMAND_TIMEOUT_SECONDS_OPTION,
      "7",
      CHUNK_TIMEOUT_SECONDS_OPTION,
      "8174",
      PREFLIGHT_TIMEOUT_SECONDS_OPTION,
      "9",
      KEEP_GOING_OPTION,
      PREFLIGHT_SCRIPT_OPTION,
      "scripts/preflight.ts",
      SUPERVISOR_LOOP_SCRIPT_OPTION,
      "scripts/loop.ts",
    ]),
    {
      help: false,
      testerConfig: "config/custom.json",
      logRoot: "log/custom",
      sessionRoot: "log/custom/validation/manual-session",
      maxChunks: 2,
      chunkMaxRuns: 3,
      stableLimit: 99,
      chunkBackoffSeconds: 4,
      betweenChunksSeconds: 5,
      childTimeoutSeconds: 102,
      commandTimeoutSeconds: 7,
      chunkTimeoutSeconds: 8174,
      preflightTimeoutSeconds: 9,
      keepGoing: true,
      preflightScript: "scripts/preflight.ts",
      supervisorLoopScript: "scripts/loop.ts",
      supervisorArgs: [],
    },
  );
  assert.deepEqual(
    parseArgs(["--", TARGET_OUTCOME_OPTION, "bot_match_committed"]).supervisorArgs,
    [TARGET_OUTCOME_OPTION, "bot_match_committed"],
  );
  assert.deepEqual(parseArgs(["--", "--help"]).supervisorArgs, ["--help"]);
  assert.deepEqual(parseArgs(["--", "-h"]).supervisorArgs, ["-h"]);
});

void test("dynamic supervisor loop derives option defaults", () => {
  assert.equal(
    parseArgs([]).childTimeoutSeconds,
    DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  );
  assert.equal(parseArgs([]).keepGoing, false);
  assert.equal(
    parseArgs([
      CHUNK_MAX_RUNS_OPTION,
      "3",
      CHILD_TIMEOUT_SECONDS_OPTION,
      "66",
      COMMAND_TIMEOUT_SECONDS_OPTION,
      "1",
      CHUNK_BACKOFF_SECONDS_OPTION,
      "4",
    ]).chunkTimeoutSeconds,
    4186,
  );
  assert.equal(
    parseArgs([CHILD_TIMEOUT_SECONDS_OPTION, "102", COMMAND_TIMEOUT_SECONDS_OPTION, "7"])
      .childTimeoutSeconds,
    102,
  );
});

void test("dynamic supervisor loop includes cleanup grace at multi-run boundaries", () => {
  for (const [runs, timeout, expectedError] of [
    [12, 4861, /expected at least 4861 seconds/u],
    [13, 4936, /expected at least 4936 seconds/u],
  ] as const) {
    const shape = [
      CHUNK_MAX_RUNS_OPTION,
      String(runs),
      CHILD_TIMEOUT_SECONDS_OPTION,
      "66",
      COMMAND_TIMEOUT_SECONDS_OPTION,
      "1",
      CHUNK_BACKOFF_SECONDS_OPTION,
      "4",
    ];
    assert.equal(parseArgs(shape).chunkTimeoutSeconds, timeout);
    assert.equal(
      parseArgs([...shape, CHUNK_TIMEOUT_SECONDS_OPTION, String(timeout)])
        .chunkTimeoutSeconds,
      timeout,
    );
    assert.throws(
      () => parseArgs([...shape, CHUNK_TIMEOUT_SECONDS_OPTION, String(timeout - 1)]),
      expectedError,
    );
  }
});

void test("dynamic supervisor loop rejects invalid numeric options", () => {
  assert.throws(
    () =>
      parseArgs([
        CHILD_TIMEOUT_SECONDS_OPTION,
        "101",
        COMMAND_TIMEOUT_SECONDS_OPTION,
        "7",
      ]),
    /Invalid --child-timeout-seconds: expected at least 102 seconds/u,
  );
  assert.throws(
    () =>
      parseArgs([
        CHUNK_MAX_RUNS_OPTION,
        String(Number.MAX_SAFE_INTEGER),
        CHILD_TIMEOUT_SECONDS_OPTION,
        String(Number.MAX_SAFE_INTEGER),
      ]),
    /Invalid --child-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([CHUNK_BACKOFF_SECONDS_OPTION, "2147484"]),
    /Invalid --chunk-backoff-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([BETWEEN_CHUNKS_SECONDS_OPTION, "2147484"]),
    /Invalid --between-chunks-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([CHILD_TIMEOUT_SECONDS_OPTION, "2147484"]),
    /Invalid --child-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([CHUNK_TIMEOUT_SECONDS_OPTION, "2147484"]),
    /Invalid --chunk-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([PREFLIGHT_TIMEOUT_SECONDS_OPTION, "2147484"]),
    /Invalid --preflight-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(() => parseArgs([MAX_CHUNKS_OPTION, "0"]), /Invalid --max-chunks/u);
  assert.throws(
    () =>
      parseArgs([CHUNK_MAX_RUNS_OPTION, "2147483", CHILD_TIMEOUT_SECONDS_OPTION, "1500"]),
    /Invalid derived --chunk-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () =>
      parseArgs([
        CHUNK_MAX_RUNS_OPTION,
        "3",
        CHILD_TIMEOUT_SECONDS_OPTION,
        "66",
        COMMAND_TIMEOUT_SECONDS_OPTION,
        "1",
        CHUNK_BACKOFF_SECONDS_OPTION,
        "4",
        CHUNK_TIMEOUT_SECONDS_OPTION,
        "4150",
      ]),
    /Invalid --chunk-timeout-seconds/u,
  );
  assert.throws(() => parseArgs(["--unknown"]), /Unknown argument/u);
});

void test("dynamic supervisor loop rejects owned supervisor arguments", () => {
  assert.throws(
    () => parseArgs(["--", "--out-dir", "log/validation/bad"]),
    /Do not pass supervisor --out-dir/u,
  );
  assert.throws(
    () => parseArgs(["--", TESTER_SCENARIO_OPTION, "random-order"]),
    /selects tester scenarios from preflight balances/u,
  );
  assert.throws(
    () => parseArgs(["--", "--tester-scenario=random-order"]),
    /Do not pass supervisor --tester-scenario/u,
  );
  assert.throws(
    () => parseArgs(["--", "--scenario", "standard-cycle"]),
    /dynamic-loop runs tester-only chunks/u,
  );
  assert.throws(
    () => parseArgs(["--", "--max-cycles", "2"]),
    /dynamic-loop owns one-cycle chunks/u,
  );
  assert.throws(
    () => parseArgs(["--", "--max-cycles=2"]),
    /dynamic-loop owns one-cycle chunks/u,
  );
  assert.throws(
    () => parseArgs(["--", MAX_CHUNKS_OPTION, "1"]),
    /Do not pass dynamic-loop option --max-chunks after --/u,
  );
  assert.throws(
    () => parseArgs(["--", "--stable-limit=2"]),
    /Do not pass dynamic-loop option --stable-limit after --/u,
  );
  assert.throws(
    () => parseArgs(["--", COMMAND_TIMEOUT_SECONDS_OPTION, "9"]),
    /Do not pass dynamic-loop option --command-timeout-seconds after --/u,
  );
});

void test("dynamic supervisor loop usage lists dynamic options", () => {
  assert.match(usage(), /tester-config/u);
  assert.match(usage(), /--log-root/u);
  assert.match(usage(), /--keep-going/u);
  assert.doesNotMatch(usage(), /--skip-build/u);
});

void test("dynamic supervisor loop passes child help through visibly", async () => {
  for (const helpFlag of ["--help", "-h"]) {
    const output = testOutput();
    const commands: Array<readonly string[]> = [];
    const exitCode = await runDynamicSupervisorLoop({
      root: "/repo",
      argv: ["--", helpFlag],
      io: { stdout: output, stderr: output },
      dependencies: {
        checkIgnored: () => {
          throw new Error("should not prepare a validation session for child help");
        },
        spawnSync: (_command: string, args: readonly string[]): SpawnResultFixture => {
          commands.push(args);
          return {
            status: 0,
            signal: null,
            stdout: `child help ${helpFlag}\n`,
            stderr: "",
          };
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(at(commands, 0), [REPO_SUPERVISOR_LOOP_SCRIPT, "--", helpFlag]);
    assert.equal(output.text.includes(`child help ${helpFlag}`), true);
  }
});
