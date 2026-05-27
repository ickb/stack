import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseArgs, resolveLauncherPaths, runBotLauncher } from "./ickb-bot-launcher.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const launcher = join(rootDir, "scripts", "ickb-bot-launcher.mjs");
const canaryPrivateKey = `0x${"42".repeat(32)}`;

test("parses launcher arguments", () => {
  assert.deepEqual(parseArgs([
    "--log-root",
    "var/bot-log",
    "--network",
    "testnet",
    "--",
    process.execPath,
    "apps/bot/dist/index.js",
  ]), {
    command: process.execPath,
    commandArgs: ["apps/bot/dist/index.js"],
    logDir: undefined,
    logRoot: "var/bot-log",
    network: "testnet",
  });

  assert.throws(() => parseArgs(["--network", "devnet", "--", process.execPath]), /Invalid network/u);
  assert.throws(() => parseArgs(["--network", "testnet", "--log-dir", "log/bot/testnet", "--", process.execPath]), /exactly one/u);
  assert.throws(() => parseArgs(["--network", "testnet"]), /Missing --/u);
});

test("resolves explicit log root before runtime env and keeps log dirs contained", () => {
  const root = resolve("/tmp/ickb-stack");
  assert.deepEqual(resolveLauncherPaths({
    cliLogRoot: "cli-log",
    envLogRoot: "env-log",
    network: "mainnet",
    root,
  }), {
    logDir: join(root, "cli-log", "bot", "mainnet"),
    logRoot: join(root, "cli-log"),
  });

  assert.deepEqual(resolveLauncherPaths({
    envLogRoot: "env-log",
    network: "testnet",
    root,
  }), {
    logDir: join(root, "env-log", "bot", "testnet"),
    logRoot: join(root, "env-log"),
  });

  assert.throws(() => resolveLauncherPaths({
    cliLogRoot: join(root, "log"),
    logDir: join(root, "outside"),
    root,
  }), /inside the resolved log root/u);
});

test("writes stdout, stderr, and launch metadata to separate append-only files", async () => {
  const dir = await tempDir();
  try {
    const first = runLauncher(dir, ["--network", "testnet"], [
      "-e",
      "process.stdout.write('event-1\\n'); process.stderr.write('stderr-1\\n');",
    ]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "event-1\n");
    assert.equal(first.stderr, "stderr-1\n");

    const second = runLauncher(dir, ["--network", "testnet"], [
      "-e",
      "process.stdout.write('event-2\\n'); process.stderr.write('stderr-2\\n');",
    ]);
    assert.equal(second.status, 0, second.stderr);

    const logDir = join(dir, "bot", "testnet");
    assert.equal(await readFile(join(logDir, "bot.events.ndjson"), "utf8"), "event-1\nevent-2\n");
    assert.equal(await readFile(join(logDir, "bot.stderr.log"), "utf8"), "stderr-1\nstderr-2\n");
    assert.equal((await stat(join(logDir, "bot.events.ndjson"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(logDir, "bot.stderr.log"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(logDir, "launches.ndjson"))).mode & 0o777, 0o600);

    const launches = await readLaunches(logDir);
    assert.equal(launches.length, 4);
    assert.equal(launches[0].type, "launcher.started");
    assert.equal(launches[0].network, "testnet");
    assert.equal(launches[0].status, null);
    assert.equal(launches[0].signal, null);
    assert.equal(launches[0].elapsedMs, 0);
    assert.equal(launches[0].command.executable, basenameOfNode());
    assert.equal(launches[0].command.argumentCount, 2);
    assert.deepEqual(launches[0].command.arguments, [
      { index: 0, value: "<omitted>" },
      { index: 1, value: "<omitted>" },
    ]);
    assert.equal(launches[1].type, "launcher.child.exited");
    assert.equal(launches[1].status, 0);
    assert.equal(launches[1].signal, null);
    assert.equal(launches[1].logRoot, dir);
    assert.equal(launches[1].logDir, logDir);
    assert.equal(launches[1].package.name, "@ickb/bot");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("copies stdout and stderr bytes without rewriting", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncherBuffer(dir, ["--network", "testnet"], [
      "-e",
      "process.stdout.write(Buffer.from([0, 255, 10])); process.stderr.write(Buffer.from([1, 254, 10]));",
    ]);
    assert.equal(result.status, 0, result.stderr.toString("utf8"));
    assert.deepEqual(result.stdout, Buffer.from([0, 255, 10]));
    assert.deepEqual(result.stderr, Buffer.from([1, 254, 10]));

    const logDir = join(dir, "bot", "testnet");
    assert.deepEqual(await readFile(join(logDir, "bot.events.ndjson")), Buffer.from([0, 255, 10]));
    assert.deepEqual(await readFile(join(logDir, "bot.stderr.log")), Buffer.from([1, 254, 10]));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses log directories that escape the resolved root", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, ["--log-dir", join(dir, "..", "escaped")], ["-e", ""]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inside the resolved log root/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("refuses symlinks in the log root, log path parents, and log files", async () => {
  const dir = await tempDir();
  try {
    const symlinkRoot = join(dir, "root-link");
    await symlink(dir, symlinkRoot, "dir");
    const symlinkRootResult = runLauncher(symlinkRoot, ["--network", "testnet"], ["-e", ""]);
    assert.equal(symlinkRootResult.status, 1);
    assert.match(symlinkRootResult.stderr, /symlink/u);

    const botParent = join(dir, "bot");
    await symlink(join(dir, "target"), botParent, "dir");
    const symlinkParentResult = runLauncher(dir, ["--network", "testnet"], ["-e", ""]);
    assert.equal(symlinkParentResult.status, 1);
    assert.match(symlinkParentResult.stderr, /symlink/u);
    await rm(botParent, { force: true, recursive: true });

    const good = runLauncher(dir, ["--network", "testnet"], ["-e", ""]);
    assert.equal(good.status, 0, good.stderr);
    const eventPath = join(dir, "bot", "testnet", "bot.events.ndjson");
    await rm(eventPath);
    await writeFile(join(dir, "target-events"), "");
    await symlink(join(dir, "target-events"), eventPath);
    const symlinkFileResult = runLauncher(dir, ["--network", "testnet"], ["-e", ""]);
    assert.equal(symlinkFileResult.status, 1);
    assert.match(symlinkFileResult.stderr, /symlink/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("preserves child exit code 2 for systemd RestartPreventExitStatus", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, ["--network", "mainnet"], ["-e", "process.exit(2);"]);
    assert.equal(result.status, 2);

    const launches = await readLaunches(join(dir, "bot", "mainnet"));
    assert.equal(launches.at(-1).status, 2);
    assert.equal(launches.at(-1).signal, null);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("tee failures do not override child exit semantics or file logs", async () => {
  const dir = await tempDir();
  try {
    const failingTee = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("journald pipe closed"));
      },
    });
    const result = await runBotLauncher({
      argv: [
        "--log-root",
        dir,
        "--network",
        "testnet",
        "--",
        process.execPath,
        "-e",
        "process.stdout.write('event\\n'); process.stderr.write('stderr\\n'); process.exit(2);",
      ],
      root: rootDir,
      stderr: failingTee,
      stdout: failingTee,
    });

    assert.deepEqual(result, { status: 2 });
    const logDir = join(dir, "bot", "testnet");
    assert.equal(await readFile(join(logDir, "bot.events.ndjson"), "utf8"), "event\n");
    assert.equal(await readFile(join(logDir, "bot.stderr.log"), "utf8"), "stderr\n");
    const launches = await readLaunches(logDir);
    assert.equal(launches.at(-1).status, 2);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("reports asynchronous child spawn errors", async () => {
  const dir = await tempDir();
  try {
    let stderr = "";
    const result = await runBotLauncher({
      argv: ["--log-root", dir, "--network", "testnet", "--", "missing-binary"],
      root: rootDir,
      spawnProcess() {
        const child = new EventEmitter();
        child.exitCode = null;
        child.killed = false;
        child.kill = () => {
          child.killed = true;
        };
        child.stderr = null;
        child.stdout = null;
        process.nextTick(() => child.emit("error", new Error("spawn ENOENT")));
        return child;
      },
      stderr: {
        write(chunk) {
          stderr += chunk;
        },
      },
    });

    assert.deepEqual(result, { status: 1 });
    assert.match(stderr, /Failed to spawn child process: spawn ENOENT/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("preserves child signal termination", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, ["--network", "testnet"], ["-e", "process.kill(process.pid, 'SIGTERM');"]);
    assert.equal(result.signal, "SIGTERM");

    const launches = await readLaunches(join(dir, "bot", "testnet"));
    assert.equal(launches.at(-1).status, null);
    assert.equal(launches.at(-1).signal, "SIGTERM");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("launcher metadata does not expose configured canary secrets", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, ["--network", "testnet"], ["-e", "process.exit(0);", canaryPrivateKey], {
      ICKB_TESTNET_BOT_PRIVATE_KEY: canaryPrivateKey,
    });
    assert.equal(result.status, 0, result.stderr);

    const logDir = join(dir, "bot", "testnet");
    const produced = [
      result.stdout,
      result.stderr,
      await readFile(join(logDir, "bot.events.ndjson"), "utf8"),
      await readFile(join(logDir, "bot.stderr.log"), "utf8"),
      await readFile(join(logDir, "launches.ndjson"), "utf8"),
    ].join("\n");
    assert.doesNotMatch(produced, new RegExp(canaryPrivateKey, "u"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

async function tempDir() {
  return mkdtemp(join(tmpdir(), "ickb-bot-launcher-"));
}

function runLauncher(logRoot, launcherArgs, childArgs, extraEnv = {}) {
  return spawnSync(process.execPath, [
    launcher,
    "--log-root",
    logRoot,
    ...launcherArgs,
    "--",
    process.execPath,
    ...childArgs,
  ], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function runLauncherBuffer(logRoot, launcherArgs, childArgs) {
  return spawnSync(process.execPath, [
    launcher,
    "--log-root",
    logRoot,
    ...launcherArgs,
    "--",
    process.execPath,
    ...childArgs,
  ], { cwd: rootDir });
}

async function readLaunches(logDir) {
  const text = await readFile(join(logDir, "launches.ndjson"), "utf8");
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

function basenameOfNode() {
  return process.execPath.split(/[\\/]/u).at(-1);
}
