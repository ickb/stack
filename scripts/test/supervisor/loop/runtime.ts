import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type BoundedCommandInvocation,
  BACKOFF_SECONDS_FLAG,
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  INSPECTION_REQUIRED_EXIT_CODE,
  LOOP_TEST_OUT_ROOT,
  MAX_RUNS_FLAG,
  OUT_ROOT_FLAG,
  SCENARIO_FLAG,
  STABLE_LIMIT_FLAG,
  assertValidationOutRootAccepted,
  commandByName,
  commandEnv,
  errorWithCode,
  join,
  runSupervisorLoop,
  summaryText,
  supervisorSpawn,
  tempRoot,
  testOutput,
} from "./support.ts";

void test("supervisor loop runs bounded supervisor commands until stable", async (t) => {
  const root = await tempRoot(t);
  const originalPrivateKey = process.env["PRIVATE_KEY"];
  process.env["PRIVATE_KEY"] = "operator-secret";
  const commands: BoundedCommandInvocation[] = [];
  try {
    const output = testOutput();

    const exitCode = await runSupervisorLoop({
      argv: [
        OUT_ROOT_FLAG,
        LOOP_TEST_OUT_ROOT,
        MAX_RUNS_FLAG,
        "5",
        STABLE_LIMIT_FLAG,
        "2",
        BACKOFF_SECONDS_FLAG,
        "0",
        "--",
        SCENARIO_FLAG,
        "bot-only",
      ],
      root,
      io: { stdout: output, stderr: output },
      dependencies: {
        spawnSync: supervisorSpawn(root, {
          commands,
          summary: summaryText({
            publicVsOwnedStateAssumptions: {
              marketOrderCount: 0,
              userOrderCount: 0,
              receiptCount: 0,
            },
          }),
        }),
      },
    });

    assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
    assert.equal(commands.length, 3);
    assert.deepEqual(
      commands.slice(0, 1).map((item) => [item.command, ...item.args]),
      [["pnpm", "live:check:source"]],
    );
    const firstSupervisor = commandByName(commands, process.execPath);
    assert.deepEqual(firstSupervisor.args.slice(-4), [
      SCENARIO_FLAG,
      "bot-only",
      "--out-dir",
      `${LOOP_TEST_OUT_ROOT}/run-0001`,
    ]);
    assert.equal(firstSupervisor.options.timeout, DEFAULT_CHILD_TIMEOUT_SECONDS * 1000);
    assert.equal(commandEnv(firstSupervisor)["NODE_OPTIONS"], undefined);
    assert.equal(commandEnv(firstSupervisor)["PRIVATE_KEY"], undefined);
    assert.match(output.text, /decision=continue/u);
    assert.match(output.text, /loop stopped reason=stable_no_progress runs=2/u);
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env["PRIVATE_KEY"];
    } else {
      process.env["PRIVATE_KEY"] = originalPrivateKey;
    }
  }
});

void test("supervisor loop prebuilds runtime before launching supervisor", async (t) => {
  const root = await tempRoot(t);
  const originalPrivateKey = process.env["PRIVATE_KEY"];
  process.env["PRIVATE_KEY"] = "operator-secret";
  const commands: BoundedCommandInvocation[] = [];
  const output = testOutput();
  try {
    const exitCode = await runSupervisorLoop({
      argv: [
        OUT_ROOT_FLAG,
        "log/live-supervisor/loop-prebuild",
        MAX_RUNS_FLAG,
        "1",
        BACKOFF_SECONDS_FLAG,
        "0",
        "--",
        SCENARIO_FLAG,
        "bot-only",
      ],
      root,
      io: { stdout: output, stderr: output },
      dependencies: {
        spawnSync: supervisorSpawn(root, { commands, summary: summaryText() }),
      },
    });

    assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE);
    assert.deepEqual(
      commands.map((item) => [item.command, ...item.args]),
      [
        ["pnpm", "live:check:source"],
        [
          process.execPath,
          join(root, "apps/validation/src/supervisor.ts"),
          SCENARIO_FLAG,
          "bot-only",
          "--out-dir",
          "log/live-supervisor/loop-prebuild/run-0001",
        ],
      ],
    );
    for (const command of commands) {
      assert.equal(commandEnv(command)["PRIVATE_KEY"], undefined);
    }
    for (const command of commands.slice(0, 1)) {
      assert.equal(command.options.stdio, "ignore");
      assert.equal(command.options.timeout, DEFAULT_CHILD_TIMEOUT_SECONDS * 1000);
      assert.equal(command.options.killSignal, "SIGTERM");
    }
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env["PRIVATE_KEY"];
    } else {
      process.env["PRIVATE_KEY"] = originalPrivateKey;
    }
  }
});

void test("supervisor loop reports prebuild failures without child output", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-prebuild-fail"],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({
        status: 1,
        stdout: "privateKey 0x1111\n",
        stderr: "operator secret 0x2222\n",
      }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.match(output.text, /target=source/u);
  assert.match(output.text, /command=pnpm_live:check:source/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111|operator secret|0x2222/u);
});

void test("supervisor loop reports timed out prebuild failures", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/live-supervisor/loop-prebuild-timeout"],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: () => ({
        status: null,
        signal: "SIGTERM",
        error: errorWithCode("spawn ETIMEDOUT", "ETIMEDOUT"),
      }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.match(output.text, /signal=SIGTERM/u);
  assert.match(output.text, /child_error=ETIMEDOUT/u);
});

void test("supervisor loop accepts validation session out roots", async (t) => {
  const root = await tempRoot(t);
  await assertValidationOutRootAccepted({
    expectedOutDir: "log/validation/dynamic-test/chunks/chunk-0001/run-0001",
    outputPattern: /out=log\/validation\/dynamic-test\/chunks\/chunk-0001/u,
    outRoot: "log/validation/dynamic-test/chunks/chunk-0001",
    root,
  });
});

void test("supervisor loop rejects validation out roots outside chunk directories", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/validation/dynamic-test"],
    root,
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /validation session chunks directory/u);
});

void test("supervisor loop rejects validation chunk root descendants", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [OUT_ROOT_FLAG, "log/validation/dynamic-test/chunks/chunk-0001/extra"],
    root,
    io: { stdout: output, stderr: output },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /validation session chunks directory/u);
});

void test("supervisor loop accepts explicit validation roots outside the repo", async (t) => {
  const root = await tempRoot(t);
  const externalRoot = await mkdtemp(path.join(tmpdir(), "ickb-loop-outside-"));
  const outRoot = path.join(externalRoot, "validation/dynamic-test/chunks/chunk-0001");
  try {
    await assertValidationOutRootAccepted({
      expectedOutDir: `${outRoot}/run-0001`,
      outputPattern: /out=.*validation\/dynamic-test\/chunks\/chunk-0001/u,
      outRoot,
      root,
    });
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
  }
});
