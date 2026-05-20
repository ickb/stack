import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  decideNext,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  summarySignature,
  usage,
} from "./ickb-supervisor-loop.mjs";

test("supervisor loop parses loop options and supervisor passthrough", () => {
  assert.equal(parseArgs(["--", "--help"]).help, true);
  assert.deepEqual(parseArgs([
    "--out-root", "logs/live-supervisor/loop-test",
    "--max-runs", "5",
    "--stable-limit", "2",
    "--backoff-seconds", "0",
    "--supervisor-script", "apps/supervisor/dist/custom.js",
    "--",
    "--scenario", "bot-only",
  ]), {
    help: false,
    outRoot: "logs/live-supervisor/loop-test",
    maxRuns: 5,
    stableLimit: 2,
    backoffSeconds: 0,
    supervisorScript: "apps/supervisor/dist/custom.js",
    supervisorArgs: ["--scenario", "bot-only"],
  });
  assert.deepEqual(parseArgs([
    "--scenario", "standard-cycle",
    "--max-cycles", "1",
  ]), {
    help: false,
    maxRuns: 10,
    stableLimit: 3,
    backoffSeconds: 30,
    supervisorScript: "apps/supervisor/dist/index.js",
    supervisorArgs: ["--scenario", "standard-cycle", "--max-cycles", "1"],
  });
  assert.throws(() => parseArgs(["--max-runs", "0"]), /Invalid --max-runs/u);
  assert.equal(parseArgs(["--max-runs", String(Number.MAX_SAFE_INTEGER)]).maxRuns, Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseArgs(["--max-runs", "9007199254740992"]), /Invalid --max-runs: expected a safe integer/u);
  assert.throws(() => parseArgs(["--stable-limit", "9007199254740992"]), /Invalid --stable-limit: expected a safe integer/u);
  assert.throws(() => parseArgs(["--backoff-seconds", "9007199254740993"]), /Invalid --backoff-seconds: expected a safe integer/u);
  assert.throws(() => parseArgs(["--", "--out-dir", "logs/live-supervisor/x"]), /Do not pass supervisor --out-dir/u);
  assert.match(usage(), /summary/u);
});

test("supervisor loop summary signatures sort skip reasons", () => {
  const base = {
    stopped: "max_cycles",
    aggregateCounts: { tester_fresh_order_skip: 1 },
    publicVsOwnedStateAssumptions: { userOrderCount: 0, marketOrderCount: 1 },
  };

  assert.equal(
    summarySignature({ ...base, skipReasons: ["b", "a"] }),
    summarySignature({ ...base, skipReasons: ["a", "b"] }),
  );
});

test("supervisor loop summarizes only summary json fields", () => {
  const summary = {
    stopped: "max_cycles",
    aggregateCounts: { bot_no_action_skip: 1, ignored_zero: 0, ignored_string: "1" },
    txHashesByOutcome: { tester_order_created: ["0xabc"], bad: [1] },
    artifacts: ["logs/live-supervisor/run/cycle-0001-incident.json"],
    skipReasons: ["fresh-matchable-order", 1],
    publicVsOwnedStateAssumptions: { userOrderCount: 0, marketOrderCount: 1, receiptCount: 2 },
  };

  assert.deepEqual(summarizeRun(summary, { runIndex: 1, relativeOutDir: "logs/live-supervisor/run", status: 0 }), {
    runIndex: 1,
    relativeOutDir: "logs/live-supervisor/run",
    status: 0,
    stopped: "max_cycles",
    aggregateCounts: { bot_no_action_skip: 1 },
    outcomes: ["bot_no_action_skip"],
    txCount: 1,
    hasIncident: true,
    skipReasons: ["fresh-matchable-order"],
    publicState: { userOrderCount: 0, marketOrderCount: 1, receiptCount: 2 },
    signature: summarySignature(summary),
  });
});

test("supervisor loop does not treat skip reference hashes as tx-bearing progress", () => {
  const run = summarizeRun({
    stopped: "max_cycles",
    aggregateCounts: { tester_fresh_order_skip: 1 },
    txHashesByOutcome: {
      tester_fresh_order_skip: ["0x" + "22".repeat(32)],
    },
    artifacts: [],
  }, { runIndex: 1, relativeOutDir: "logs/live-supervisor/run", status: 0 });

  assert.equal(run.txCount, 0);
});

test("supervisor loop decisions stop on incident, tx, new outcome, and stable no-progress", () => {
  const priorOutcomes = new Set(["bot_no_action_skip"]);
  const baseRun = {
    status: 0,
    hasIncident: false,
    txCount: 0,
    outcomes: ["bot_no_action_skip"],
    signature: "same",
  };

  assert.equal(decideNext({
    run: { ...baseRun, status: 1 },
    priorOutcomes,
    previousSignature: "other",
    stableCount: 0,
    stableLimit: 3,
    runIndex: 2,
    maxRuns: 10,
  }).reason, "supervisor_nonzero");
  assert.equal(decideNext({
    run: { ...baseRun, hasIncident: true },
    priorOutcomes,
    previousSignature: "other",
    stableCount: 0,
    stableLimit: 3,
    runIndex: 2,
    maxRuns: 10,
  }).reason, "incident");
  assert.equal(decideNext({
    run: { ...baseRun, txCount: 1 },
    priorOutcomes,
    previousSignature: "other",
    stableCount: 0,
    stableLimit: 3,
    runIndex: 2,
    maxRuns: 10,
  }).reason, "tx_observed");
  assert.equal(decideNext({
    run: { ...baseRun, outcomes: ["tester_fresh_order_skip"] },
    priorOutcomes,
    previousSignature: "other",
    stableCount: 0,
    stableLimit: 3,
    runIndex: 2,
    maxRuns: 10,
  }).reason, "new_outcome");
  assert.equal(decideNext({
    run: baseRun,
    priorOutcomes,
    previousSignature: "same",
    stableCount: 2,
    stableLimit: 3,
    runIndex: 3,
    maxRuns: 10,
  }).reason, "stable_no_progress");
});

test("supervisor loop runs bounded supervisor commands until stable", async () => {
  const root = "/repo";
  const reads = new Map();
  const commands = [];
  for (let index = 1; index <= 2; index += 1) {
    reads.set(join(root, "logs/live-supervisor/loop-test", `run-${String(index).padStart(4, "0")}`, "summary.json"), JSON.stringify({
      stopped: "max_cycles",
      aggregateCounts: { bot_no_action_skip: 1 },
      txHashesByOutcome: {},
      artifacts: [],
      publicVsOwnedStateAssumptions: { marketOrderCount: 0, userOrderCount: 0, receiptCount: 0 },
    }));
  }
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const exitCode = await runSupervisorLoop({
    argv: [
      "--out-root", "logs/live-supervisor/loop-test",
      "--max-runs", "5",
      "--stable-limit", "2",
      "--backoff-seconds", "0",
      "--",
      "--scenario", "bot-only",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        return { status: 0 };
      },
      readFile: async (path) => reads.get(path),
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0].args.slice(-4), ["--scenario", "bot-only", "--out-dir", "logs/live-supervisor/loop-test/run-0001"]);
  assert.match(output.text, /decision=continue/u);
  assert.match(output.text, /loop stopped reason=stable_no_progress runs=2/u);
});

test("supervisor loop stops for inspection on new tx-bearing summary", async () => {
  const root = "/repo";
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-tx", "--backoff-seconds", "0"],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({ status: 0 }),
      readFile: async () => JSON.stringify({
        stopped: "stop_after_tx_count",
        aggregateCounts: { tester_order_created: 1 },
        txHashesByOutcome: { tester_order_created: ["0x" + "11".repeat(32)] },
        artifacts: [],
      }),
    },
  });

  assert.equal(exitCode, 0);
  assert.match(output.text, /decision=tx_observed/u);
  assert.match(output.text, /tx=1/u);
});

test("supervisor loop reports invalid out-root as a concise CLI error", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "config/not-allowed"],
    root: "/repo",
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /--out-root must be under logs\/live-supervisor/u);
  assert.doesNotMatch(output.text, /\n\s+at\s/u);
});

test("supervisor loop hides invalid summary JSON contents", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-invalid", "--backoff-seconds", "0"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({ status: 0 }),
      readFile: async () => '{"privateKey":"0x1111",',
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /summary\.json_invalid_JSON/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111/u);
});
