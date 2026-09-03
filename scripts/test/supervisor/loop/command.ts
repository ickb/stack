import assert from "node:assert/strict";
import test from "node:test";
import {
  type BoundedCommandInvocation,
  type CommandInvocation,
  BACKOFF_SECONDS_FLAG,
  CHILD_TIMEOUT_SECONDS_FLAG,
  OUT_ROOT_FLAG,
  commandByName,
  errorWithCode,
  runSupervisorLoop,
  supervisorSpawn,
  tempRoot,
  testOutput,
} from "./support.ts";

void test("supervisor loop applies child timeout at the outer process boundary", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const commands: CommandInvocation[] = [];
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-timeout",
      CHILD_TIMEOUT_SECONDS_FLAG,
      "1",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        return command === process.execPath
          ? {
              status: null,
              signal: "SIGTERM",
              error: errorWithCode("spawnSync timed out", "ETIMEDOUT"),
            }
          : { status: 0 };
      },
    },
  });

  assert.equal(exitCode, 1);
  const supervisorCommand = commandByName(commands, process.execPath);
  assert.equal(supervisorCommand.options.timeout, 1000);
  assert.equal(supervisorCommand.options.killSignal, "SIGTERM");
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.match(output.text, /child_error=ETIMEDOUT/u);
  assert.match(output.text, /signal=SIGTERM/u);
});

void test("supervisor loop reports child timeout metadata when summary exists", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-timeout-summary",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: supervisorSpawn(root, {
        summary: JSON.stringify({
          stopped: "max_wall_clock_seconds",
          aggregateCounts: { bot_no_action_skip: 1 },
          txCreatingTxHashCount: 0,
          txCreatingOutcomeCount: 0,
          artifacts: [],
        }),
        result: {
          status: null,
          signal: "SIGTERM",
          error: errorWithCode("spawnSync timed out", "ETIMEDOUT"),
        },
      }),
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /decision=supervisor_nonzero/u);
  assert.match(output.text, /child_error=ETIMEDOUT/u);
  assert.match(output.text, /signal=SIGTERM/u);
});

void test("supervisor loop does not print arbitrary child output on missing summary", async (t) => {
  const root = await tempRoot(t);
  const commands: BoundedCommandInvocation[] = [];
  const output = testOutput();
  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      "log/live-supervisor/loop-private-child-output",
      BACKOFF_SECONDS_FLAG,
      "0",
    ],
    root,
    io: { stdout: output, stderr: output },
    dependencies: {
      spawnSync: (command, args, options) => {
        commands.push({ command, args, options });
        if (command !== process.execPath) {
          return { status: 0 };
        }
        return {
          status: 1,
          stdout: "privateKey 0x1111\n",
          stderr:
            "Live supervisor failed: Missing runtime dependency\noperator secret 0x2222\n",
        };
      },
    },
  });

  assert.equal(exitCode, 1);
  const supervisorCommand = commandByName(commands, process.execPath);
  assert.equal(supervisorCommand.options.stdio, "ignore");
  assert.match(output.text, /summary=missing_or_invalid/u);
  assert.doesNotMatch(
    output.text,
    /privateKey|0x1111|Missing runtime dependency|operator secret|0x2222/u,
  );
});
