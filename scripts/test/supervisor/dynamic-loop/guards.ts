import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CHILD_TIMEOUT_SECONDS_OPTION,
  COMMAND_TIMEOUT_SECONDS_OPTION,
  LIVE_CHECK_SOURCE_COMMAND,
  LIVE_SUPERVISOR_OUT,
  SUPERVISOR_LOOP_SCRIPT,
  TESTER_CONFIG_OPTION,
  TESTER_CONFIG_SPAWN_ERROR,
  argsByScript,
  dynamicDependencies,
  isPrebuildCommand,
  loggedDynamicSpawn,
  maxRunsSupervisorResult,
  okResult,
  parseArgs,
  preflightResult,
  runDynamicSupervisorLoop,
  sessionFile,
  tempRoot,
  testOutput,
  validationArgs,
  validationRoot,
} from "./support.ts";

const { join } = path;
const ELSEWHERE = "elsewhere";
const RACED_SESSION = "raced-session";

void test("dynamic supervisor loop refuses non-ignored tester configs before session artifacts", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: [
      TESTER_CONFIG_OPTION,
      "tracked-config.json",
      ...validationArgs("config-boundary"),
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: (relativePath: string) => relativePath.startsWith("log/"),
      spawnSync: () => {
        throw new Error(TESTER_CONFIG_SPAWN_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(join(root, "log")), false);
  assert.match(
    output.text,
    /Refusing to use non-ignored --tester-config: tracked-config\.json/u,
  );
});

void test("dynamic supervisor loop refuses out-of-repo tester configs before session artifacts", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: [
      TESTER_CONFIG_OPTION,
      "../tester-testnet.json",
      ...validationArgs("config-outside"),
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => {
        throw new Error("should not check ignore for out-of-repo tester config");
      },
      spawnSync: () => {
        throw new Error(TESTER_CONFIG_SPAWN_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(join(root, "log")), false);
  assert.match(output.text, /--tester-config must stay inside the repo/u);
});

void test("dynamic supervisor loop refuses symlinked tester config paths before session artifacts", async (t) => {
  const root = await tempRoot(t);
  await mkdir(join(root, ELSEWHERE));
  await writeFile(join(root, ELSEWHERE, "tester-testnet.json"), "{}");
  await symlink(join(root, ELSEWHERE), join(root, "config"));
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: [
      TESTER_CONFIG_OPTION,
      "config/tester-testnet.json",
      ...validationArgs("config-symlink"),
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: (relativePath: string) =>
        relativePath.startsWith("config/") || relativePath.startsWith("log/"),
      spawnSync: () => {
        throw new Error(TESTER_CONFIG_SPAWN_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(join(root, "log")), false);
  assert.equal(
    output.text.includes(
      `Refusing to use tester config through symlinked path: ${join(root, "config")}`,
    ),
    true,
  );
});

void test("dynamic supervisor loop forwards a child timeout that covers actor command timeout", async (t) => {
  const root = await tempRoot(t);
  const commands: Array<readonly string[]> = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs(
      "timeout-session",
      "1",
      CHILD_TIMEOUT_SECONDS_OPTION,
      "5460",
      COMMAND_TIMEOUT_SECONDS_OPTION,
      "900",
    ),
    io: { stdout: output, stderr: output },
    dependencies: dynamicDependencies(
      loggedDynamicSpawn({
        argsLog: commands,
        preflight: preflightResult({ ckb: "1000", ickb: "0", feeRate: "0" }),
        supervisor: maxRunsSupervisorResult({ out: LIVE_SUPERVISOR_OUT }),
      }),
    ),
  });

  const supervisorArgs = argsByScript(commands, SUPERVISOR_LOOP_SCRIPT);
  assert.equal(exitCode, 3);
  assert.equal(
    supervisorArgs[supervisorArgs.indexOf(CHILD_TIMEOUT_SECONDS_OPTION) + 1],
    "5460",
  );
  assert.equal(
    supervisorArgs[supervisorArgs.indexOf(COMMAND_TIMEOUT_SECONDS_OPTION) + 1],
    "900",
  );
});

void test("dynamic supervisor loop rejects child timeouts that cannot cover one delegated supervisor run", () => {
  assert.throws(
    () =>
      parseArgs([
        CHILD_TIMEOUT_SECONDS_OPTION,
        "960",
        COMMAND_TIMEOUT_SECONDS_OPTION,
        "900",
      ]),
    /Invalid --child-timeout-seconds: expected at least 5460 seconds/u,
  );
});

void test("dynamic supervisor loop reports prebuild failures before opening sessions", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs("prebuild-failure"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: () => ({
        status: 1,
        signal: null,
        stdout: "privateKey 0x1111\n",
        stderr: "operator secret 0x2222\n",
      }),
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(existsSync(join(validationRoot(root), "prebuild-failure")), false);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111|operator secret|0x2222/u);
});

void test("dynamic supervisor loop refuses sessions created during prebuild", async (t) => {
  const root = await tempRoot(t);
  const commands: Array<readonly string[]> = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs(RACED_SESSION),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: (_command: string, args: readonly string[]) => {
        commands.push(args);
        if (isPrebuildCommand(args)) {
          // Another process claims the session root while the prebuild runs.
          mkdirSync(join(validationRoot(root), RACED_SESSION), { recursive: true });
          return okResult();
        }
        throw new Error("should not spawn preflight or supervisor after raced session");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(commands, [[LIVE_CHECK_SOURCE_COMMAND]]);
  assert.equal(sessionFile(root, RACED_SESSION, "launch.json"), undefined);
  assert.match(
    output.text,
    /Validation session root already exists: log\/validation\/raced-session/u,
  );
});

void test("dynamic supervisor loop refuses symlinked session parents created during prebuild", async (t) => {
  const root = await tempRoot(t);
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root,
    argv: validationArgs("raced-symlink"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      spawnSync: (_command: string, args: readonly string[]) => {
        if (isPrebuildCommand(args)) {
          // Another process swaps the validation parent for a symlink while the prebuild runs.
          mkdirSync(join(root, "log"), { recursive: true });
          mkdirSync(join(root, ELSEWHERE));
          symlinkSync(join(root, ELSEWHERE), validationRoot(root));
          return okResult();
        }
        throw new Error("should not spawn preflight or supervisor through raced symlink");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(sessionFile(root, "raced-symlink", "launch.json"), undefined);
  assert.equal(
    output.text.includes(
      `Refusing to use session root through symlinked path: ${validationRoot(root)}`,
    ),
    true,
  );
});
