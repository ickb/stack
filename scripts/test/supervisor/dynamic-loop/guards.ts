import assert from "node:assert/strict";
import test from "node:test";
import {
  CHILD_TIMEOUT_SECONDS_OPTION,
  COMMAND_TIMEOUT_SECONDS_OPTION,
  LIVE_CHECK_SOURCE_COMMAND,
  LIVE_SUPERVISOR_OUT,
  SUPERVISOR_LOOP_SCRIPT,
  TESTER_CONFIG_MKDIR_ERROR,
  TESTER_CONFIG_OPTION,
  TESTER_CONFIG_SPAWN_ERROR,
  TESTER_CONFIG_WRITE_ERROR,
  VALIDATION_ROOT,
  argsByScript,
  dynamicDependencies,
  errorWithCode,
  isPrebuildCommand,
  loggedDynamicSpawn,
  maxRunsSupervisorResult,
  missingStat,
  okResult,
  parseArgs,
  preflightResult,
  runDynamicSupervisorLoop,
  testOutput,
  validationArgs,
} from "./support.ts";

void test("dynamic supervisor loop refuses non-ignored tester configs before session artifacts", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      TESTER_CONFIG_OPTION,
      "tracked-config.json",
      ...validationArgs("config-boundary"),
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: (path: string) => path.startsWith("log/"),
      spawnSync: () => {
        throw new Error(TESTER_CONFIG_SPAWN_ERROR);
      },
      mkdir: () => {
        throw new Error(TESTER_CONFIG_MKDIR_ERROR);
      },
      writeFile: () => {
        throw new Error(TESTER_CONFIG_WRITE_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(
    output.text,
    /Refusing to use non-ignored --tester-config: tracked-config\.json/u,
  );
});

void test("dynamic supervisor loop refuses out-of-repo tester configs before session artifacts", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
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
      mkdir: () => {
        throw new Error(TESTER_CONFIG_MKDIR_ERROR);
      },
      writeFile: () => {
        throw new Error(TESTER_CONFIG_WRITE_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output.text, /--tester-config must stay inside the repo/u);
});

void test("dynamic supervisor loop refuses symlinked tester config paths before session artifacts", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: [
      TESTER_CONFIG_OPTION,
      "config/tester-testnet.json",
      ...validationArgs("config-symlink"),
    ],
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: (path: string) =>
        path.startsWith("config/") || path.startsWith("log/"),
      lstat: (path: string): { isSymbolicLink: () => boolean } => ({
        isSymbolicLink: (): boolean => path === "/repo/config",
      }),
      spawnSync: () => {
        throw new Error(TESTER_CONFIG_SPAWN_ERROR);
      },
      mkdir: () => {
        throw new Error(TESTER_CONFIG_MKDIR_ERROR);
      },
      writeFile: () => {
        throw new Error(TESTER_CONFIG_WRITE_ERROR);
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(
    output.text,
    /Refusing to use tester config through symlinked path: \/repo\/config/u,
  );
});

void test("dynamic supervisor loop forwards a child timeout that covers actor command timeout", async () => {
  const commands: Array<readonly string[]> = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
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

void test("dynamic supervisor loop reports prebuild failures before opening sessions", async () => {
  const output = testOutput();
  let mkdirCalled = false;
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("prebuild-failure"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: () => {
        mkdirCalled = true;
      },
      spawnSync: () => ({
        status: 1,
        signal: null,
        stdout: "privateKey 0x1111\n",
        stderr: "operator secret 0x2222\n",
      }),
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(mkdirCalled, false);
  assert.match(output.text, /loop prebuild_failed/u);
  assert.doesNotMatch(output.text, /privateKey|0x1111|operator secret|0x2222/u);
});

void test("dynamic supervisor loop refuses sessions created during prebuild", async () => {
  const commands: Array<readonly string[]> = [];
  const mkdirs: string[] = [];
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("raced-session"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: missingStat,
      mkdir: (path: string) => {
        mkdirs.push(path);
        if (path === `${VALIDATION_ROOT}/raced-session`) {
          throw errorWithCode("exists", "EEXIST");
        }
      },
      writeFile: () => {
        throw new Error("should not write launch artifact after raced session");
      },
      appendFile: () => {
        throw new Error("should not write events after raced session");
      },
      spawnSync: (_command: string, args: readonly string[]) => {
        commands.push(args);
        if (isPrebuildCommand(args)) {
          return okResult();
        }
        throw new Error("should not spawn preflight or supervisor after raced session");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(commands, [[LIVE_CHECK_SOURCE_COMMAND]]);
  assert.deepEqual(mkdirs, [VALIDATION_ROOT, `${VALIDATION_ROOT}/raced-session`]);
  assert.match(
    output.text,
    /Validation session root already exists: log\/validation\/raced-session/u,
  );
});

void test("dynamic supervisor loop refuses symlinked session parents created during prebuild", async () => {
  const output = testOutput();
  const exitCode = await runDynamicSupervisorLoop({
    root: "/repo",
    argv: validationArgs("raced-symlink"),
    io: { stdout: output, stderr: output },
    dependencies: {
      checkIgnored: () => true,
      stat: missingStat,
      lstat: (path: string): { isSymbolicLink: () => boolean } => ({
        isSymbolicLink: (): boolean => path === VALIDATION_ROOT,
      }),
      mkdir: () => true,
      writeFile: () => {
        throw new Error("should not write launch artifact through raced symlink");
      },
      appendFile: () => {
        throw new Error("should not write events through raced symlink");
      },
      spawnSync: (_command: string, args: readonly string[]) => {
        if (isPrebuildCommand(args)) {
          return okResult();
        }
        throw new Error("should not spawn preflight or supervisor through raced symlink");
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.match(
    output.text,
    /Refusing to use session root through symlinked path: \/repo\/log\/validation/u,
  );
});
