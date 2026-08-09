import assert from "node:assert/strict";
import test from "node:test";
import {
  type CommandInvocation,
  type SummaryRecord,
  BACKOFF_SECONDS_FLAG,
  LIVE_RUN_OUT_DIR,
  OUT_ROOT_FLAG,
  freshLoopOutputDependencies,
  join,
  runSupervisorLoop,
  summarizeRun,
  testOutput,
} from "./support.ts";

void test("supervisor loop stops for inspection on new tx-bearing summary", async () => {
  const root = "/repo";
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-tx", BACKOFF_SECONDS_FLAG, "0"],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "stop_after_tx_count",
          aggregateCounts: { tester_order_created: 1 },
          txCreatingTxHashCount: 1,
          txCreatingOutcomeCount: 1,
          txHashesByOutcome: { tester_order_created: [`0x${"11".repeat(32)}`] },
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 0);
  assert.match(output.text, /decision=tx_observed/u);
  assert.match(output.text, /tx=1/u);
  assert.match(output.text, /txOutcomes=1/u);
});

void test("supervisor loop prints tx-creating outcome count when hashes are missing", async () => {
  const root = "/repo";
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-tx-outcome",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { tester_order_created: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 1,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 0);
  assert.match(output.text, /decision=tx_observed/u);
  assert.match(output.text, /tx=0/u);
  assert.match(output.text, /txOutcomes=1/u);
});

void test("supervisor loop requires summary-owned tx counters", () => {
  const summaryWithOnlyLegacyHashes: SummaryRecord = {
    stopped: "max_cycles",
    aggregateCounts: { tester_order_created: 1 },
    txHashesByOutcome: { tester_order_created: [`0x${"11".repeat(32)}`] },
    artifacts: [],
  };
  assert.throws(
    () =>
      summarizeRun(summaryWithOnlyLegacyHashes, {
        runIndex: 1,
        relativeOutDir: LIVE_RUN_OUT_DIR,
        status: 0,
      }),
    /txCreatingTxHashCount/u,
  );
});

void test("supervisor loop rejects malformed aggregateCounts as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-invalid-counts",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: null,
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /aggregateCounts_missing_or_invalid/u);
  assert.doesNotMatch(output.text, /decision=stable_no_progress|outcomes=-/u);
});

void test("supervisor loop rejects malformed aggregateCounts values as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-invalid-count-values",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { bot_no_action_skip: "1" },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /aggregateCounts_missing_or_invalid/u);
  assert.doesNotMatch(output.text, /decision=stable_no_progress|outcomes=-/u);
});

void test("supervisor loop rejects malformed aggregateCounts keys as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-invalid-count-keys",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { "bot_no_action_skip status=0": 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /aggregateCounts_key_missing_or_invalid/u);
  assert.doesNotMatch(output.text, /bot_no_action_skip status=0/u);
});

void test("supervisor loop rejects malformed stopped tokens as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-invalid-stopped",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles status=0",
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /stopped_missing_or_invalid/u);
  assert.doesNotMatch(output.text, /max_cycles status=0/u);
});

void test("supervisor loop rejects missing stopped as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-missing-stopped",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /stopped_missing_or_invalid/u);
  assert.doesNotMatch(output.text, /bot_no_action_skip status=0/u);
});

void test("supervisor loop rejects malformed artifacts as invalid summary evidence", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-invalid-artifacts",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () =>
        JSON.stringify({
          stopped: "max_cycles",
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [1],
        }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /artifacts_missing_or_invalid/u);
  assert.doesNotMatch(
    output.text,
    /decision=stable_no_progress|outcomes=bot_no_action_skip/u,
  );
});

void test("supervisor loop refuses symlinked output roots", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-symlink"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      lstat: (filePath) => ({
        isSymbolicLink: (): boolean =>
          filePath === join("/repo", "log", "live-supervisor"),
      }),
      spawnSync: () => {
        throw new Error("should not spawn supervisor through symlinked output root");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(
    output.text,
    /Refusing to use loop output root through symlinked path: log\/live-supervisor/u,
  );
});

void test("supervisor loop reports invalid out-root as a concise CLI error", async () => {
  const output = testOutput();

  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "config/not-allowed"],
    root: "/repo",
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(
    output.text,
    /--out-root must be under log\/live-supervisor or a validation session chunks directory/u,
  );
  assert.equal(output.text.includes("\n    at "), false);
});

void test("supervisor loop hides invalid summary JSON contents", async () => {
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-invalid", BACKOFF_SECONDS_FLAG, "0"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: () => ({ status: 0 }),
      readFile: () => '{"privateKey":"0x1111",',
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /summary\.json_invalid_JSON/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111/u);
});

void test("supervisor loop refuses to reuse existing output roots before spawning", async () => {
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-existing"],
    root: "/repo",
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(["/repo/log/live-supervisor/loop-existing"]),
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        return { status: 0 };
      },
      readFile: () => {
        throw new Error("should not read stale summary from reused output root");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(commands.length, 0);
  assert.match(
    output.text,
    /Refusing to reuse loop output root: log\/live-supervisor\/loop-existing/u,
  );
});
