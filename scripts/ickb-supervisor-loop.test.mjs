import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  decideNext,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE,
  DEFAULT_PREBUILD_TIMEOUT_SECONDS_VALUE,
  INSPECTION_REQUIRED_EXIT_CODE,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  summarySignature,
  usage,
} from "./ickb-supervisor-loop.mjs";

test("supervisor loop parses loop options and supervisor passthrough", () => {
  assert.deepEqual(parseArgs(["--", "--help"]).supervisorArgs, ["--help"]);
  assert.deepEqual(parseArgs(["--", "-h"]).supervisorArgs, ["-h"]);
  assert.deepEqual(parseArgs([
    "--out-root", "logs/live-supervisor/loop-test",
    "--max-runs", "5",
    "--stable-limit", "2",
    "--backoff-seconds", "0",
    "--child-timeout-seconds", "120",
    "--skip-build",
    "--supervisor-script", "apps/supervisor/dist/custom.js",
    "--",
    "--scenario", "bot-only",
  ]), {
    help: false,
    skipBuild: true,
    outRoot: "logs/live-supervisor/loop-test",
    maxRuns: 5,
    stableLimit: 2,
    backoffSeconds: 0,
    childTimeoutSeconds: 120,
    supervisorScript: "apps/supervisor/dist/custom.js",
    supervisorArgs: ["--scenario", "bot-only"],
  });
  assert.throws(() => parseArgs(["--scenario", "standard-cycle"]), /Unknown argument before --: --scenario/u);
  assert.deepEqual(parseArgs(["--max-runs", "1", "--", "--scenario", "standard-cycle"]).supervisorArgs, [
    "--scenario",
    "standard-cycle",
  ]);
  assert.throws(() => parseArgs(["--max-runs", "0"]), /Invalid --max-runs/u);
  assert.equal(parseArgs(["--max-runs", String(Number.MAX_SAFE_INTEGER)]).maxRuns, Number.MAX_SAFE_INTEGER);
  assert.throws(() => parseArgs(["--max-runs", "9007199254740992"]), /Invalid --max-runs: expected a safe integer/u);
  assert.throws(() => parseArgs(["--stable-limit", "9007199254740992"]), /Invalid --stable-limit: expected a safe integer/u);
  assert.throws(() => parseArgs(["--backoff-seconds", "9007199254740993"]), /Invalid --backoff-seconds: expected a safe integer/u);
  assert.throws(() => parseArgs(["--child-timeout-seconds", "0"]), /Invalid --child-timeout-seconds/u);
  assert.throws(() => parseArgs(["--", "--out-dir", "logs/live-supervisor/x"]), /Do not pass supervisor --out-dir/u);
  assert.throws(() => parseArgs(["--", "--out-dir=logs/live-supervisor/x"]), /Do not pass supervisor --out-dir/u);
  assert.throws(() => parseArgs(["--", "--max-runs", "1", "--scenario", "standard-cycle"]), /Do not pass loop option --max-runs after --/u);
  assert.throws(() => parseArgs(["--", "--skip-build"]), /Do not pass loop option --skip-build after --/u);
  assert.throws(() => parseArgs(["--", "--stable-limit=2"]), /Do not pass loop option --stable-limit after --/u);
  assert.throws(() => parseArgs(["--scenario", "standard-cycle", "--out-dir=logs/live-supervisor/x"]), /Unknown argument before --: --scenario/u);
  assert.equal(parseArgs([]).childTimeoutSeconds, DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE);
  assert.match(usage(), /summary/u);
  assert.match(usage(), /--out-root <dir>/u);
});

test("supervisor loop passes child help through visibly", async () => {
  for (const helpFlag of ["--help", "-h"]) {
    const output = { text: "", write(chunk) { this.text += chunk; } };
    const commands = [];
    const exitCode = await runSupervisorLoop({
      argv: ["--", helpFlag],
      root: "/repo",
      io: { stdout: output, stderr: output },
      dependencies: {
        spawnSync: (_command, args, options) => {
          commands.push({ args, options });
          return { status: 0, stdout: `child help ${helpFlag}\n`, stderr: "child warning\n" };
        },
        readFile: async () => {
          throw new Error("should not read summary for child help");
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(commands[0].args, ["/repo/apps/supervisor/dist/index.js", helpFlag]);
    assert.deepEqual(commands[0].options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(commands[0].options.encoding, "utf8");
    assert.equal(output.text.includes(`child help ${helpFlag}`), true);
    assert.equal(output.text.includes("child warning"), true);
  }
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
  assert.notEqual(
    summarySignature({ ...base, preflightState: [{ balances: { CKB: { available: "2000" } } }] }),
    summarySignature({ ...base, preflightState: [{ balances: { CKB: { available: "2001" } } }] }),
  );
});

test("supervisor loop summarizes only summary json fields", () => {
  const summary = {
    stopped: "max_cycles",
    aggregateCounts: { bot_no_action_skip: 1, ignored_zero: 0, ignored_string: "1" },
    txCreatingTxHashCount: 1,
    txCreatingOutcomeCount: 0,
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
    hasTxCreatingOutcome: false,
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
    txCreatingTxHashCount: 0,
    txCreatingOutcomeCount: 0,
    artifacts: [],
  }, { runIndex: 1, relativeOutDir: "logs/live-supervisor/run", status: 0 });

  assert.equal(run.txCount, 0);
  assert.equal(run.hasTxCreatingOutcome, false);
});

test("supervisor loop stops on tx-creating outcomes even when tx hashes are missing", () => {
  const run = summarizeRun({
    stopped: "max_cycles",
    aggregateCounts: { tester_order_created: 1 },
    txCreatingTxHashCount: 0,
    txCreatingOutcomeCount: 1,
    artifacts: [],
  }, { runIndex: 1, relativeOutDir: "logs/live-supervisor/run", status: 0 });

  assert.equal(run.txCount, 0);
  assert.equal(run.hasTxCreatingOutcome, true);
  assert.equal(decideNext({
    run,
    priorOutcomes: new Set(),
    previousSignature: undefined,
    stableCount: 0,
    stableLimit: 3,
    runIndex: 1,
    maxRuns: 10,
  }).reason, "tx_observed");
});

test("supervisor loop decisions stop on incident, tx, new outcome, max runs, and stable no-progress", () => {
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
    run: { ...baseRun, status: 2, hasIncident: true },
    priorOutcomes,
    previousSignature: "other",
    stableCount: 0,
    stableLimit: 3,
    runIndex: 2,
    maxRuns: 10,
  }).reason, "incident");
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

test("supervisor loop runs bounded supervisor commands until stable", async () => {
  const root = "/repo";
  const originalPrivateKey = process.env.PRIVATE_KEY;
  process.env.PRIVATE_KEY = "operator-secret";
  const reads = new Map();
  const commands = [];
  try {
    for (let index = 1; index <= 2; index += 1) {
      reads.set(join(root, "logs/live-supervisor/loop-test", `run-${String(index).padStart(4, "0")}`, "summary.json"), JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
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
        "--skip-build",
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

    assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[0].args.slice(-4), ["--scenario", "bot-only", "--out-dir", "logs/live-supervisor/loop-test/run-0001"]);
    assert.equal(commands[0].options.timeout, DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE * 1000);
    assert.equal(commands[0].options.env.NODE_OPTIONS, "--disable-warning=DEP0040");
    assert.equal(commands[0].options.env.PRIVATE_KEY, undefined);
    assert.match(output.text, /decision=continue/u);
    assert.match(output.text, /loop stopped reason=stable_no_progress runs=2/u);
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env.PRIVATE_KEY;
    } else {
      process.env.PRIVATE_KEY = originalPrivateKey;
    }
  }
});

test("supervisor loop prebuilds runtime before launching supervisor", async () => {
  const root = "/repo";
  const originalPrivateKey = process.env.PRIVATE_KEY;
  process.env.PRIVATE_KEY = "operator-secret";
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  try {
    const exitCode = await runSupervisorLoop({
      argv: [
        "--out-root", "logs/live-supervisor/loop-prebuild",
        "--max-runs", "1",
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
        readFile: async () => JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
      },
    });

    assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
    assert.deepEqual(commands.map((item) => [item.command, ...item.args]), [
      ["pnpm", "forks:ccc"],
      ["pnpm", "bot:build"],
      ["pnpm", "--filter", "@ickb/tester", "build"],
      ["pnpm", "--filter", "@ickb/supervisor", "build"],
      [process.execPath, "/repo/apps/supervisor/dist/index.js", "--scenario", "bot-only", "--out-dir", "logs/live-supervisor/loop-prebuild/run-0001"],
    ]);
    for (const command of commands) {
      assert.equal(command.options.env.PRIVATE_KEY, undefined);
    }
    for (const command of commands.slice(0, 4)) {
      assert.equal(command.options.stdio, "ignore");
      assert.equal(command.options.timeout, DEFAULT_PREBUILD_TIMEOUT_SECONDS_VALUE * 1000);
      assert.equal(command.options.killSignal, "SIGTERM");
    }
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env.PRIVATE_KEY;
    } else {
      process.env.PRIVATE_KEY = originalPrivateKey;
    }
  }
});

test("supervisor loop reports prebuild failures without child output", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-prebuild-fail"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({
        status: 1,
        stdout: "privateKey 0x1111\n",
        stderr: "operator secret 0x2222\n",
      }),
      readFile: async () => {
        throw new Error("should not read summary after prebuild failure");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.match(output.text, /target=ccc/u);
  assert.match(output.text, /command=pnpm_forks:ccc/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111|operator secret|0x2222/u);
});

test("supervisor loop reports timed out prebuild failures", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-prebuild-timeout"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({
        status: null,
        signal: "SIGTERM",
        error: Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" }),
      }),
      readFile: async () => {
        throw new Error("should not read summary after prebuild timeout");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.match(output.text, /signal=SIGTERM/u);
  assert.match(output.text, /child_error=ETIMEDOUT/u);
});

test("supervisor loop accepts validation session out roots", async () => {
  const root = "/repo";
  const reads = new Map([
    [join(root, "log/validation/dynamic-test/chunks/chunk-0001/run-0001/summary.json"), JSON.stringify({
      stopped: "max_cycles",
      aggregateCounts: { bot_no_action_skip: 1 },
      txCreatingTxHashCount: 0,
      txCreatingOutcomeCount: 0,
      artifacts: [],
    })],
  ]);
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const exitCode = await runSupervisorLoop({
    argv: [
      "--out-root", "log/validation/dynamic-test/chunks/chunk-0001",
      "--max-runs", "1",
      "--skip-build",
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

  assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
  assert.deepEqual(commands[0].args.slice(-4), ["--scenario", "bot-only", "--out-dir", "log/validation/dynamic-test/chunks/chunk-0001/run-0001"]);
  assert.match(output.text, /out=log\/validation\/dynamic-test\/chunks\/chunk-0001/u);
});

test("supervisor loop rejects validation out roots outside chunk directories", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "log/validation/dynamic-test"],
    root: "/repo",
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /validation session chunks directory/u);
});

test("supervisor loop rejects validation chunk root descendants", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "log/validation/dynamic-test/chunks/chunk-0001/extra"],
    root: "/repo",
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /validation session chunks directory/u);
});

test("supervisor loop accepts explicit validation roots outside the repo", async () => {
  const root = "/repo";
  const reads = new Map([
    ["/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001/summary.json", JSON.stringify({
      stopped: "max_cycles",
      aggregateCounts: { bot_no_action_skip: 1 },
      txCreatingTxHashCount: 0,
      txCreatingOutcomeCount: 0,
      artifacts: [],
    })],
  ]);
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const exitCode = await runSupervisorLoop({
    argv: [
      "--out-root", "/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001",
      "--max-runs", "1",
      "--skip-build",
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

  assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
  assert.deepEqual(commands[0].args.slice(-4), ["--scenario", "bot-only", "--out-dir", "/var/tmp/ickb-log/validation/dynamic-test/chunks/chunk-0001/run-0001"]);
  assert.match(output.text, /out=\/var\/tmp\/ickb-log\/validation\/dynamic-test\/chunks\/chunk-0001/u);
});

test("supervisor loop applies child timeout at the outer process boundary", async () => {
  const root = "/repo";
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const commands = [];
  const exitCode = await runSupervisorLoop({
    argv: [
      "--out-root", "logs/live-supervisor/loop-timeout",
      "--child-timeout-seconds", "1",
      "--backoff-seconds", "0",
      "--skip-build",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        return { status: null, signal: "SIGTERM", error: Object.assign(new Error("spawnSync timed out"), { code: "ETIMEDOUT" }) };
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(commands[0].options.timeout, 1000);
  assert.equal(commands[0].options.killSignal, "SIGTERM");
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /child_error=ETIMEDOUT/u);
  assert.match(output.text, /signal=SIGTERM/u);
});

test("supervisor loop does not print arbitrary child output on missing summary", async () => {
  const commands = [];
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-private-child-output", "--backoff-seconds", "0", "--skip-build"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        return {
          status: 1,
          stdout: "privateKey 0x1111\n",
          stderr: "Live supervisor failed: Missing built bot app: apps/bot/dist/index.js\noperator secret 0x2222\n",
        };
      },
      readFile: async () => {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(commands[0].options.stdio, "ignore");
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111|Missing built bot app|operator secret|0x2222/u);
});

test("supervisor loop stops for inspection on new tx-bearing summary", async () => {
  const root = "/repo";
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-tx", "--backoff-seconds", "0", "--skip-build"],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({ status: 0 }),
      readFile: async () => JSON.stringify({
        stopped: "stop_after_tx_count",
        aggregateCounts: { tester_order_created: 1 },
        txCreatingTxHashCount: 1,
        txCreatingOutcomeCount: 1,
        txHashesByOutcome: { tester_order_created: ["0x" + "11".repeat(32)] },
        artifacts: [],
      }),
    },
  });

  assert.equal(exitCode, 0);
  assert.match(output.text, /decision=tx_observed/u);
  assert.match(output.text, /tx=1/u);
});

test("supervisor loop requires summary-owned tx counters", () => {
  assert.throws(() => summarizeRun({
    stopped: "max_cycles",
    aggregateCounts: { tester_order_created: 1 },
    txHashesByOutcome: { tester_order_created: ["0x" + "11".repeat(32)] },
    artifacts: [],
  }, { runIndex: 1, relativeOutDir: "logs/live-supervisor/run", status: 0 }), /txCreatingTxHashCount/u);
});

test("supervisor loop refuses symlinked output roots", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-symlink"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      lstat: async (path) => ({ isSymbolicLink: () => path === join("/repo", "logs", "live-supervisor") }),
      spawnSync: () => {
        throw new Error("should not spawn supervisor through symlinked output root");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /Refusing to use loop output root through symlinked path: logs\/live-supervisor/u);
});

test("supervisor loop reports invalid out-root as a concise CLI error", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };

  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "config/not-allowed"],
    root: "/repo",
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /--out-root must be under logs\/live-supervisor or a validation session chunks directory/u);
  assert.doesNotMatch(output.text, /\n\s+at\s/u);
});

test("supervisor loop hides invalid summary JSON contents", async () => {
  const output = { text: "", write(chunk) { this.text += chunk; } };
  const exitCode = await runSupervisorLoop({
    argv: ["--out-root", "logs/live-supervisor/loop-invalid", "--backoff-seconds", "0", "--skip-build"],
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
