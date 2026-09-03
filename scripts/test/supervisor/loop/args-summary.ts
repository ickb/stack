import assert from "node:assert/strict";
import test from "node:test";
import {
  type BoundedCommandInvocation,
  BACKOFF_SECONDS_FLAG,
  CHILD_TIMEOUT_SECONDS_FLAG,
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  INSPECTION_REQUIRED_EXIT_CODE,
  LIVE_RUN_OUT_DIR,
  LOOP_TEST_OUT_ROOT,
  MAX_RUNS_FLAG,
  OUT_ROOT_FLAG,
  SCENARIO_FLAG,
  STABLE_LIMIT_FLAG,
  STANDARD_SCENARIO,
  at,
  decideNext,
  join,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  summarySignature,
  supervisorSpawn,
  tempRoot,
  testOutput,
  usage,
} from "./support.ts";

void test("supervisor loop parses accepted loop options and supervisor passthrough", () => {
  assert.deepEqual(parseArgs(["--", "--help"]).supervisorArgs, ["--help"]);
  assert.deepEqual(parseArgs(["--", "-h"]).supervisorArgs, ["-h"]);
  assert.deepEqual(
    parseArgs([
      OUT_ROOT_FLAG,
      LOOP_TEST_OUT_ROOT,
      MAX_RUNS_FLAG,
      "5",
      STABLE_LIMIT_FLAG,
      "2",
      BACKOFF_SECONDS_FLAG,
      "0",
      CHILD_TIMEOUT_SECONDS_FLAG,
      "120",
      "--supervisor-script",
      "apps/validation/src/customSupervisor.ts",
      "--",
      SCENARIO_FLAG,
      "bot-only",
    ]),
    {
      help: false,
      outRoot: LOOP_TEST_OUT_ROOT,
      maxRuns: 5,
      stableLimit: 2,
      backoffSeconds: 0,
      childTimeoutSeconds: 120,
      supervisorScript: "apps/validation/src/customSupervisor.ts",
      supervisorArgs: [SCENARIO_FLAG, "bot-only"],
    },
  );
  assert.deepEqual(
    parseArgs([MAX_RUNS_FLAG, "1", "--", SCENARIO_FLAG, STANDARD_SCENARIO])
      .supervisorArgs,
    [SCENARIO_FLAG, STANDARD_SCENARIO],
  );
  assert.equal(
    parseArgs([MAX_RUNS_FLAG, String(Number.MAX_SAFE_INTEGER)]).maxRuns,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(parseArgs([]).childTimeoutSeconds, DEFAULT_CHILD_TIMEOUT_SECONDS);
  assert.match(usage(), /summary/u);
  assert.match(usage(), /--out-root <dir>/u);
});

void test("supervisor loop rejects invalid loop option placement and values", () => {
  assert.throws(
    () => parseArgs([SCENARIO_FLAG, STANDARD_SCENARIO]),
    /Unknown argument before --: --scenario/u,
  );
  assert.throws(() => parseArgs([MAX_RUNS_FLAG, "0"]), /Invalid --max-runs/u);
  assert.throws(
    () => parseArgs([MAX_RUNS_FLAG, "9007199254740992"]),
    /Invalid --max-runs: expected a safe integer/u,
  );
  assert.throws(
    () => parseArgs([STABLE_LIMIT_FLAG, "9007199254740992"]),
    /Invalid --stable-limit: expected a safe integer/u,
  );
  assert.throws(
    () => parseArgs([BACKOFF_SECONDS_FLAG, "9007199254740993"]),
    /Invalid --backoff-seconds: expected a safe integer/u,
  );
  assert.throws(
    () => parseArgs([BACKOFF_SECONDS_FLAG, "2147484"]),
    /Invalid --backoff-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs([CHILD_TIMEOUT_SECONDS_FLAG, "0"]),
    /Invalid --child-timeout-seconds/u,
  );
  assert.throws(
    () => parseArgs([CHILD_TIMEOUT_SECONDS_FLAG, "2147484"]),
    /Invalid --child-timeout-seconds: expected at most 2147483 seconds/u,
  );
  assert.throws(
    () => parseArgs(["--", "--out-dir", "log/live-supervisor/x"]),
    /Do not pass supervisor --out-dir/u,
  );
  assert.throws(
    () => parseArgs(["--", "--out-dir=log/live-supervisor/x"]),
    /Do not pass supervisor --out-dir/u,
  );
  assert.throws(
    () => parseArgs(["--", MAX_RUNS_FLAG, "1", SCENARIO_FLAG, STANDARD_SCENARIO]),
    /Do not pass loop option --max-runs after --/u,
  );
  assert.throws(
    () => parseArgs(["--skip-build"]),
    /Unknown argument before --: --skip-build/u,
  );
  assert.throws(
    () => parseArgs(["--", `${STABLE_LIMIT_FLAG}=2`]),
    /Do not pass loop option --stable-limit after --/u,
  );
  assert.throws(
    () =>
      parseArgs([SCENARIO_FLAG, STANDARD_SCENARIO, "--out-dir=log/live-supervisor/x"]),
    /Unknown argument before --: --scenario/u,
  );
});

void test("supervisor loop passes child help through visibly", async (t) => {
  const root = await tempRoot(t);
  for (const helpFlag of ["--help", "-h"]) {
    const output = testOutput();
    const commands: BoundedCommandInvocation[] = [];
    const exitCode = await runSupervisorLoop({
      argv: ["--", helpFlag],
      root,
      io: { stdout: output, stderr: output },
      dependencies: {
        spawnSync: (command, args, options) => {
          commands.push({ command, args, options });
          return {
            status: 0,
            stdout: `child help ${helpFlag}\n`,
            stderr: "child warning\n",
          };
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(at(commands, 0).args, [
      join(root, "apps/validation/src/supervisor.ts"),
      helpFlag,
    ]);
    assert.deepEqual(at(commands, 0).options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(at(commands, 0).options.encoding, "utf8");
    assert.equal(output.text.includes(`child help ${helpFlag}`), true);
    assert.equal(output.text.includes("child warning"), true);
  }
});

void test("supervisor loop summary signatures sort skip reasons", () => {
  const base = {
    stopped: "max_cycles",
    aggregateCounts: { tester_fresh_order_skip: 1 },
    publicVsOwnedStateAssumptions: { userOrderCount: 0, marketOrderCount: 1 },
  };

  assert.equal(
    summarySignature({ ...base, skipReasons: ["b", "a"] }),
    summarySignature({ ...base, skipReasons: ["a", "b"] }),
  );
  assert.notEqual(
    summarySignature({
      ...base,
      preflightState: [{ balances: { CKB: { available: "2000" } } }],
    }),
    summarySignature({
      ...base,
      preflightState: [{ balances: { CKB: { available: "2001" } } }],
    }),
  );
});

void test("supervisor loop summarizes only summary json fields", () => {
  const summary = {
    stopped: "max_cycles",
    aggregateCounts: { bot_no_action_skip: 1, ignored_zero: 0 },
    txCreatingTxHashCount: 1,
    txCreatingOutcomeCount: 0,
    artifacts: [`${LIVE_RUN_OUT_DIR}/cycle-0001-incident.json`],
    skipReasons: ["fresh-matchable-order", 1],
    publicVsOwnedStateAssumptions: {
      userOrderCount: 0,
      marketOrderCount: 1,
      receiptCount: 2,
    },
  };

  assert.deepEqual(
    summarizeRun(summary, {
      runIndex: 1,
      relativeOutDir: LIVE_RUN_OUT_DIR,
      status: 0,
    }),
    {
      runIndex: 1,
      relativeOutDir: LIVE_RUN_OUT_DIR,
      status: 0,
      stopped: "max_cycles",
      aggregateCounts: { bot_no_action_skip: 1 },
      outcomes: ["bot_no_action_skip"],
      txCount: 1,
      txCreatingOutcomeCount: 0,
      hasTxCreatingOutcome: false,
      hasIncident: true,
      skipReasons: ["fresh-matchable-order"],
      stopDiagnosticReason: undefined,
      publicState: { userOrderCount: 0, marketOrderCount: 1, receiptCount: 2 },
      signature: summarySignature(summary),
    },
  );
});

void test("supervisor loop prints summary-owned stop diagnostics", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-stop-diagnostics",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: supervisorSpawn(root, {
        summary: JSON.stringify({
          stopped: "max_wall_clock_seconds",
          stopDiagnostics: { reason: "insufficient_wall_clock_command_budget" },
          aggregateCounts: {},
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
      }),
    },
  });

  assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
  assert.match(output.text, /stopped=max_wall_clock_seconds/u);
  assert.match(output.text, /stop=insufficient_wall_clock_command_budget/u);
});

void test("supervisor loop does not treat skip reference hashes as tx-bearing progress", () => {
  const run = summarizeRun(
    {
      stopped: "max_cycles",
      aggregateCounts: { tester_fresh_order_skip: 1 },
      txCreatingTxHashCount: 0,
      txCreatingOutcomeCount: 0,
      artifacts: [],
    },
    { runIndex: 1, relativeOutDir: LIVE_RUN_OUT_DIR, status: 0 },
  );

  assert.equal(run.txCount, 0);
  assert.equal(run.hasTxCreatingOutcome, false);
});

void test("supervisor loop stops on tx-creating outcomes even when tx hashes are missing", () => {
  const run = summarizeRun(
    {
      stopped: "max_cycles",
      aggregateCounts: { tester_order_created: 1 },
      txCreatingTxHashCount: 0,
      txCreatingOutcomeCount: 1,
      artifacts: [],
    },
    { runIndex: 1, relativeOutDir: LIVE_RUN_OUT_DIR, status: 0 },
  );

  assert.equal(run.txCount, 0);
  assert.equal(run.txCreatingOutcomeCount, 1);
  assert.equal(run.hasTxCreatingOutcome, true);
  assert.equal(
    decideNext({
      run,
      priorOutcomes: new Set(),
      previousSignature: undefined,
      stableCount: 0,
      stableLimit: 3,
      runIndex: 1,
      maxRuns: 10,
    }).reason,
    "tx_observed",
  );
});

void test("supervisor loop decisions stop on incident, tx, and new outcome", () => {
  const priorOutcomes = new Set(["bot_no_action_skip"]);
  const baseRun = {
    status: 0,
    hasIncident: false,
    txCount: 0,
    outcomes: ["bot_no_action_skip"],
    signature: "same",
  };

  assert.equal(
    decideNext({
      run: { ...baseRun, status: 1 },
      priorOutcomes,
      previousSignature: "other",
      stableCount: 0,
      stableLimit: 3,
      runIndex: 2,
      maxRuns: 10,
    }).reason,
    "supervisor_nonzero",
  );
  assert.equal(
    decideNext({
      run: { ...baseRun, status: 2, hasIncident: true },
      priorOutcomes,
      previousSignature: "other",
      stableCount: 0,
      stableLimit: 3,
      runIndex: 2,
      maxRuns: 10,
    }).reason,
    "incident",
  );
  assert.equal(
    decideNext({
      run: { ...baseRun, hasIncident: true },
      priorOutcomes,
      previousSignature: "other",
      stableCount: 0,
      stableLimit: 3,
      runIndex: 2,
      maxRuns: 10,
    }).reason,
    "incident",
  );
  assert.equal(
    decideNext({
      run: { ...baseRun, txCount: 1 },
      priorOutcomes,
      previousSignature: "other",
      stableCount: 0,
      stableLimit: 3,
      runIndex: 2,
      maxRuns: 10,
    }).reason,
    "tx_observed",
  );
  assert.equal(
    decideNext({
      run: { ...baseRun, outcomes: ["tester_fresh_order_skip"] },
      priorOutcomes,
      previousSignature: "other",
      stableCount: 0,
      stableLimit: 3,
      runIndex: 2,
      maxRuns: 10,
    }).reason,
    "new_outcome",
  );
});

void test("supervisor loop decisions stop on max runs and stable no-progress", () => {
  const priorOutcomes = new Set(["bot_no_action_skip"]);
  const baseRun = {
    status: 0,
    hasIncident: false,
    txCount: 0,
    outcomes: ["bot_no_action_skip"],
    signature: "same",
  };

  const stableDecision = decideNext({
    run: baseRun,
    priorOutcomes,
    previousSignature: "same",
    stableCount: 2,
    stableLimit: 3,
    runIndex: 3,
    maxRuns: 10,
  });
  assert.equal(stableDecision.reason, "stable_no_progress");
  assert.equal(stableDecision.exitCode, INSPECTION_REQUIRED_EXIT_CODE);
  const maxRunsDecision = decideNext({
    run: baseRun,
    priorOutcomes,
    previousSignature: "same",
    stableCount: 2,
    stableLimit: 3,
    runIndex: 3,
    maxRuns: 3,
  });
  assert.equal(maxRunsDecision.reason, "max_runs");
  assert.equal(maxRunsDecision.exitCode, INSPECTION_REQUIRED_EXIT_CODE);
});
