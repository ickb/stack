import assert from "node:assert/strict";
import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  type CommandInvocation,
  type SpawnResultFixture,
  type TestSpawnOptions,
  LIVE_CHECK_SOURCE_COMMAND,
  LOG_ROOT_OPTION,
  MAX_CHUNKS_OPTION,
  OUT_ROOT_OPTION,
  PREFLIGHT_SCRIPT,
  SESSION_ROOT_OPTION,
  SUPERVISOR_LOOP_SCRIPT,
  at,
  commandEnv,
  dynamicDependencies,
  loggedDynamicSpawn,
  preflightResult,
  runDynamicSupervisorLoop,
  sessionFile,
  tempRoot,
  testOutput,
  validationArgs,
  validationRoot,
} from "./support.ts";

const { join } = path;

void test("dynamic loop git ignore guard runs with an allowlisted environment", async (t) => {
  const root = await tempRoot(t);
  const originalPrivateKey = process.env["PRIVATE_KEY"];
  process.env["PRIVATE_KEY"] = "operator-secret";
  const output = testOutput();
  const gitEnvs: Array<Record<string, string | undefined>> = [];
  try {
    const exitCode = await runDynamicSupervisorLoop({
      root,
      argv: validationArgs("git-env"),
      io: { stdout: output, stderr: output },
      dependencies: {
        now: () => 1700000000123,
        spawnSync: (
          command: string,
          args: readonly string[],
          options: TestSpawnOptions,
        ): SpawnResultFixture => {
          if (command === "git") {
            gitEnvs.push(commandEnv({ command, args, options }));
            return { status: 0, signal: null, stdout: "", stderr: "" };
          }
          if (args[0] === PREFLIGHT_SCRIPT) {
            return preflightResult({
              ckb: "3200",
              plainCkb: "3200",
              ickb: "0",
              feeRate: "0",
            });
          }
          if (args[0] === SUPERVISOR_LOOP_SCRIPT) {
            return {
              status: 0,
              signal: null,
              stdout:
                "loop stopped reason=tx_observed runs=1 out=log/validation/git-env/chunks/chunk-0001\n",
              stderr: "",
            };
          }
          return { status: 0, signal: null, stdout: "", stderr: "" };
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(gitEnvs.length, 2);
    assert.equal(at(gitEnvs, 0)["PRIVATE_KEY"], undefined);
    assert.equal(at(gitEnvs, 0)["NODE_OPTIONS"], undefined);
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env["PRIVATE_KEY"];
    } else {
      process.env["PRIVATE_KEY"] = originalPrivateKey;
    }
  }
});

void test("dynamic supervisor loop creates a default validation session root", async (t) => {
  const root = await tempRoot(t);
  const originalPrivateKey = process.env["PRIVATE_KEY"];
  process.env["PRIVATE_KEY"] = "operator-secret";
  const commands: CommandInvocation[] = [];
  const output = testOutput();
  const session = "dynamic-1700000000-4321";
  const chunkRoot = "log/validation/dynamic-1700000000-4321/chunks/chunk-0001";
  try {
    const exitCode = await runDynamicSupervisorLoop({
      root,
      argv: [MAX_CHUNKS_OPTION, "1"],
      io: { stdout: output, stderr: output },
      dependencies: dynamicDependencies(
        loggedDynamicSpawn({
          commands,
          preflight: preflightResult({
            ckb: "3200",
            plainCkb: "3200",
            projectedCkb: "4200",
            ickb: "0",
            unavailableIckb: "100",
            totalIckb: "100",
            feeRate: "0",
          }),
          supervisor: {
            status: 0,
            stdout: `loop stopped reason=max_runs runs=1 out=${chunkRoot}\n`,
          },
        }),
        {
          now: () => 1700000000123,
          pid: 4321,
          checkIgnored: (relativePath: string) =>
            relativePath.startsWith("config/") || relativePath.startsWith("log/"),
        },
      ),
    });

    assert.equal(exitCode, 3);
    assert.notEqual(sessionFile(root, session, "launch.json"), undefined);
    assert.notEqual(sessionFile(root, session, "events.ndjson"), undefined);
    assert.deepEqual(
      commands.slice(0, 1).map((item) => item.args),
      [[LIVE_CHECK_SOURCE_COMMAND]],
    );
    assert.deepEqual(at(commands, 2).args.slice(0, 3), [
      SUPERVISOR_LOOP_SCRIPT,
      OUT_ROOT_OPTION,
      chunkRoot,
    ]);
    assert.equal(at(commands, 2).args.includes("--skip-build"), false);
    assert.equal(commandEnv(at(commands, 1))["NODE_OPTIONS"], undefined);
    assert.equal(commandEnv(at(commands, 2))["NODE_OPTIONS"], undefined);
    for (const command of commands) {
      assert.equal(commandEnv(command)["PRIVATE_KEY"], undefined);
    }
    assert.match(output.text, /"type":"chunk_finished"/u);
    assert.match(output.text, /testerPlainCkbAvailable":"3200"/u);
    assert.match(output.text, /testerProjectedCkbAvailable":"4200"/u);
    assert.match(output.text, /testerIckbUnavailable":"100"/u);
    assert.match(output.text, /testerIckbTotal":"100"/u);
    assert.match(
      output.text,
      /log\/validation\/dynamic-1700000000-4321\/chunks\/chunk-0001/u,
    );
  } finally {
    if (originalPrivateKey === undefined) {
      delete process.env["PRIVATE_KEY"];
    } else {
      process.env["PRIVATE_KEY"] = originalPrivateKey;
    }
  }
});

void test("dynamic supervisor loop validates explicit session roots", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();

  const outsideExit = await runDynamicSupervisorLoop({
    root,
    argv: [
      LOG_ROOT_OPTION,
      "log",
      SESSION_ROOT_OPTION,
      "other/session",
      MAX_CHUNKS_OPTION,
      "1",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn with invalid session root");
      },
    },
  });
  assert.equal(outsideExit, 1);
  assert.match(output.text, /--session-root must stay under --log-root/u);

  output.text = "";
  const badShapeExit = await runDynamicSupervisorLoop({
    root,
    argv: [
      LOG_ROOT_OPTION,
      "log",
      SESSION_ROOT_OPTION,
      "log/manual-session",
      MAX_CHUNKS_OPTION,
      "1",
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn with invalid session root shape");
      },
    },
  });
  assert.equal(badShapeExit, 1);
  assert.match(output.text, /--session-root must be <log-root>\/validation\/<session>/u);

  output.text = "";
  await mkdir(join(validationRoot(root), "existing"), { recursive: true });
  const reusedExit = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs("existing"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn with reused session root");
      },
    },
  });
  assert.equal(reusedExit, 1);
  assert.match(
    output.text,
    /Validation session root already exists: log\/validation\/existing/u,
  );
});

void test("dynamic supervisor loop refuses symlinked session roots", async (t) => {
  const root = await tempRoot(t);
  await mkdir(join(root, "log"));
  await mkdir(join(root, "elsewhere"));
  await symlink(join(root, "elsewhere"), validationRoot(root));
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs("symlinked"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => {
        throw new Error("should not spawn through symlinked session root");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(
    output.text.includes(
      `Refusing to use session root through symlinked path: ${validationRoot(root)}`,
    ),
    true,
  );
});
