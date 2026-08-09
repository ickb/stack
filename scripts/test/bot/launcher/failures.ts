import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { failLaunch, waitForChildClose } from "../../../bot/launcher/runtime/process.ts";
import {
  LogSink,
  PassThrough,
  Writable,
  assertLauncherOutputHidesCanary,
  botEvent,
  canaryPrivateKey,
  childFixture,
  copyBytes,
  eventsSlot00File,
  eventsSlot01File,
  join,
  lastLaunch,
  launcher,
  linkSymbolic,
  logRootOption,
  processIdentityFixture,
  readLaunches,
  readText,
  rm,
  rootDir,
  runBotLauncher,
  runLauncher,
  stderrSlot00File,
  tempDir,
  writeBotEventScript,
  writeText,
} from "./support.ts";

const legacyLauncherLockFile = ".launcher.lock";

void test("refuses log directories that escape the resolved root", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(
      dir,
      ["--log-dir", join(dir, "..", "escaped")],
      ["-e", ""],
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /inside the resolved log root/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("refuses symlinks in the log root, log path parents, and log files", async () => {
  const dir = await tempDir();
  try {
    const symlinkRoot = join(dir, "root-link");
    await linkSymbolic(dir, symlinkRoot, "dir");
    const symlinkRootResult = runLauncher(symlinkRoot, [], ["-e", ""]);
    assert.equal(symlinkRootResult.status, 1);
    assert.match(symlinkRootResult.stderr, /symlink/u);

    const botParent = join(dir, "bot");
    await linkSymbolic(join(dir, "target"), botParent, "dir");
    const symlinkParentResult = runLauncher(dir, [], ["-e", ""]);
    assert.equal(symlinkParentResult.status, 1);
    assert.match(symlinkParentResult.stderr, /symlink/u);
    await rm(botParent, { force: true, recursive: true });

    const good = runLauncher(dir, [], ["-e", ""]);
    assert.equal(good.status, 0, good.stderr);
    const eventPath = join(dir, "bot", eventsSlot01File);
    await writeText(eventPath, "");
    await rm(eventPath);
    await writeText(join(dir, "target-events"), "");
    await linkSymbolic(join(dir, "target-events"), eventPath);
    const symlinkFileResult = runLauncher(dir, [], ["-e", ""]);
    assert.equal(symlinkFileResult.status, 1);
    assert.match(symlinkFileResult.stderr, /symlink/u);

    await rm(eventPath, { force: true, recursive: true });
    await rm(join(dir, "bot", "artifacts"), { force: true, recursive: true });
    await linkSymbolic(
      join(dir, "target-artifacts"),
      join(dir, "bot", "artifacts"),
      "dir",
    );
    const symlinkArtifactParentResult = runLauncher(dir, [], ["-e", ""]);
    assert.equal(symlinkArtifactParentResult.status, 1);
    assert.match(symlinkArtifactParentResult.stderr, /symlink/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("holds exclusive log ownership and releases it after SIGKILL", async () => {
  const dir = await tempDir();
  const firstMarker = join(dir, "first-spawned");
  const secondMarker = join(dir, "second-spawned");
  const first = spawn(
    process.execPath,
    [
      launcher,
      logRootOption,
      dir,
      "--",
      process.execPath,
      "-e",
      "const parent = process.ppid; require('node:fs').writeFileSync(process.argv[1], 'first'); setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 10);",
      firstMarker,
    ],
    { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  let firstStderr = "";
  first.stderr.setEncoding("utf8");
  first.stderr.on("data", (chunk: string) => {
    firstStderr += chunk;
  });
  try {
    await waitForText(firstMarker, "first");
    await assert.rejects(
      async () => readText(join(dir, "bot", legacyLauncherLockFile)),
      /ENOENT/u,
    );

    const second = runLauncher(
      dir,
      [],
      [
        "-e",
        "require('node:fs').writeFileSync(process.argv[1], 'second');",
        secondMarker,
      ],
    );
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already owned by another launcher/u);
    assert.equal(second.stderr.includes(dir), false);
    await assert.rejects(async () => readText(secondMarker), /ENOENT/u);
    await assert.rejects(
      async () => readText(join(dir, "bot", eventsSlot01File)),
      /ENOENT/u,
    );
    assert.equal(await readText(firstMarker), "first");

    first.kill("SIGKILL");
    const firstExit = await waitForClose(first);
    assert.deepEqual(firstExit, { signal: "SIGKILL", status: null }, firstStderr);
    await assert.rejects(
      async () => readText(join(dir, "bot", legacyLauncherLockFile)),
      /ENOENT/u,
    );

    const afterExit = runLauncher(dir, [], ["-e", ""]);
    assert.equal(afterExit.status, 0, afterExit.stderr);
  } finally {
    if (first.exitCode === null && first.signalCode === null) {
      first.kill("SIGKILL");
      await waitForClose(first);
    }
    await rm(dir, { force: true, recursive: true });
  }
});

void test("preserves child exit code 2 for systemd RestartPreventExitStatus", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, [], ["-e", "process.exit(2);"]);
    assert.equal(result.status, 2);

    const launches = await readLaunches(join(dir, "bot"));
    const childExit = lastLaunch(launches);
    assert.equal(childExit.status, 2);
    assert.equal(childExit.signal, null);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("tee failures do not override child exit semantics or file logs", async () => {
  const dir = await tempDir();
  try {
    const failingTee = new Writable({
      write(_chunk, _encoding, callback): void {
        callback(new Error("journald pipe closed"));
      },
    });
    const result = await runBotLauncher({
      argv: [
        logRootOption,
        dir,
        "--",
        process.execPath,
        "-e",
        String.raw`${writeBotEventScript("tee-failure")} process.stderr.write('stderr\n'); process.exit(2);`,
      ],
      root: rootDir,
      stderr: failingTee,
      stdout: failingTee,
    });

    assert.deepEqual(result, { status: 2 });
    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), botEvent("tee-failure"));
    assert.equal(await readText(join(logDir, stderrSlot00File)), "stderr\n");
    const launches = await readLaunches(logDir);
    assert.equal(lastLaunch(launches).status, 2);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("reports asynchronous child spawn errors", async () => {
  const dir = await tempDir();
  try {
    let stderr = "";
    const result = await runBotLauncher({
      argv: [logRootOption, dir, "--", "missing-binary"],
      root: rootDir,
      readProcessIdentity: processIdentityFixture,
      spawnProcess() {
        const child = childFixture({ pid: 1234 });
        queueMicrotask((): void => {
          child.emit("error", new Error("spawn ENOENT"));
          child.emit("close", null, null);
        });
        return child;
      },
      stderr: {
        write(chunk: string | Uint8Array): boolean {
          stderr +=
            typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
          return true;
        },
      },
    });

    assert.deepEqual(result, { status: 1 });
    assert.match(stderr, /Failed to spawn child process: spawn ENOENT/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("holds ownership until a PID-bearing child closes after an error", async () => {
  const dir = await tempDir();
  try {
    const { promise: childSpawned, resolve: spawned } =
      Promise.withResolvers<ReturnType<typeof childFixture>>();
    let firstSettled = false;
    const firstLaunch = (async (): Promise<
      Awaited<ReturnType<typeof runBotLauncher>>
    > => {
      const result = await runBotLauncher({
        argv: [logRootOption, dir, "--", "fixture-child"],
        root: rootDir,
        readProcessIdentity: processIdentityFixture,
        spawnProcess() {
          const child = childFixture({ pid: 1234 });
          spawned(child);
          return child;
        },
        stderr: { write: () => true },
      });
      firstSettled = true;
      return result;
    })();

    const child = await childSpawned;
    child.emit("error", new Error("spawn EIO"));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(firstSettled, false);

    let secondStderr = "";
    const second = await runBotLauncher({
      argv: [logRootOption, dir, "--", "must-not-spawn"],
      root: rootDir,
      spawnProcess() {
        throw new Error("second launcher must not spawn a child");
      },
      stderr: {
        write(chunk: string | Uint8Array): boolean {
          secondStderr += chunk.toString();
          return true;
        },
      },
    });
    assert.deepEqual(second, { status: 1 });
    assert.match(secondStderr, /already owned by another launcher/u);
    assert.equal(firstSettled, false);

    child.emit("close", 7, null);
    assert.deepEqual(await firstLaunch, { status: 1 });
    const launches = await readLaunches(join(dir, "bot"));
    assert.equal(lastLaunch(launches).status, 7);
    assert.equal(lastLaunch(launches).signal, null);

    const afterClose = runLauncher(dir, [], ["-e", ""]);
    assert.equal(afterClose.status, 0, afterClose.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("copy failures destroy the readable stream", async () => {
  const readable = new PassThrough();
  const failure = new Error("disk full");
  const copy = copyBytes(
    readable,
    {
      async write(): Promise<void> {
        await Promise.resolve();
        throw failure;
      },
    },
    new Writable({
      write(_chunk, _encoding, callback): void {
        callback();
      },
    }),
  );

  readable.write("event\n");

  await assert.rejects(copy, /disk full/u);
  assert.equal(readable.destroyed, true);
});

void test("copy failures reject even when stream destroy does not emit error", async () => {
  const readable = new PassThrough();
  const failure = new Error("disk full");
  readable.destroy = (): PassThrough => readable;
  const copy = copyBytes(
    readable,
    {
      async write(): Promise<void> {
        await Promise.resolve();
        throw failure;
      },
    },
    new Writable({
      write(_chunk, _encoding, callback): void {
        callback();
      },
    }),
  );

  readable.write("event\n");

  await assert.rejects(copy, /disk full/u);
});

void test("log sinks close file handles after pending write failures", async () => {
  let closed = false;
  const sink = new LogSink({
    async appendFile(): Promise<void> {
      await Promise.resolve();
      throw new Error("disk full");
    },
    async close(): Promise<void> {
      await Promise.resolve();
      closed = true;
    },
    async truncate(): Promise<void> {
      await Promise.resolve();
    },
  });

  const write = sink.write("event\n");

  await assert.rejects(write, /disk full/u);
  await assert.rejects(sink.close(), /disk full/u);
  assert.equal(closed, true);
});

void test("output sink failures terminate and reap a non-exiting child before settling", async () => {
  const child = childFixture();
  const signals: Array<NodeJS.Signals | number | undefined> = [];
  let reaped = false;
  child.kill = (signal): boolean => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      queueMicrotask(() => {
        reaped = true;
        child.emit("close", null, "SIGKILL");
      });
    }
    return true;
  };

  const result = await failLaunch({
    child,
    childClosePromise: waitForChildClose(child),
    error: new Error("durable output sink failed"),
    stderr: { write: () => true },
    terminationGraceMs: 1,
  });

  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(reaped, true);
  assert.deepEqual(result, { status: 1 });
});

void test("post-spawn launcher failures reap the child before closing sinks", async () => {
  const child = childFixture();
  const order: string[] = [];
  const sinkClose = "sink-close";
  child.kill = (signal): boolean => {
    order.push(String(signal));
    queueMicrotask(() => {
      order.push("close");
      child.emit("close", null, "SIGTERM");
    });
    return true;
  };
  const sink = {
    async close(): Promise<void> {
      await Promise.resolve();
      order.push(sinkClose);
    },
    async write(): Promise<void> {
      await Promise.resolve();
    },
    async writeLine(): Promise<void> {
      await Promise.resolve();
    },
  };

  await failLaunch({
    child,
    childClosePromise: waitForChildClose(child),
    error: new Error("launch record failed"),
    removeSignalHandlers: () => {
      order.push("remove-handlers");
    },
    sinks: { events: sink, launches: sink, stderr: sink },
    stderr: { write: () => true },
    terminationGraceMs: 1,
  });

  assert.deepEqual(order, [
    "remove-handlers",
    "SIGTERM",
    "close",
    sinkClose,
    sinkClose,
    sinkClose,
  ]);
});

void test("preserves child signal termination", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, [], ["-e", "process.kill(process.pid, 'SIGTERM');"]);
    assert.equal(result.signal, "SIGTERM");

    const launches = await readLaunches(join(dir, "bot"));
    const childExit = lastLaunch(launches);
    assert.equal(childExit.status, null);
    assert.equal(childExit.signal, "SIGTERM");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("launcher metadata does not expose configured canary secrets", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(dir, [], ["-e", "process.exit(0);", canaryPrivateKey], {
      ICKB_TESTNET_BOT_PRIVATE_KEY: canaryPrivateKey,
    });
    assert.equal(result.status, 0, result.stderr);

    await assertLauncherOutputHidesCanary(dir, result.stdout, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("launcher passes child environment without logging canary secrets", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(
      dir,
      [],
      ["-e", "process.exit(process.env.IKCB_CANARY_CHILD_ENV === undefined ? 7 : 0);"],
      {
        IKCB_CANARY_CHILD_ENV: canaryPrivateKey,
      },
    );
    assert.equal(result.status, 0, result.stderr);

    await assertLauncherOutputHidesCanary(dir, result.stdout, result.stderr);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

async function waitForText(filePath: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await readText(filePath)) === expected) {
        return;
      }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("ENOENT")) {
        throw error;
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`Timed out waiting for launcher child marker: ${filePath}`);
}

async function waitForClose(child: ReturnType<typeof spawn>): Promise<{
  signal: NodeJS.Signals | null;
  status: number | null;
}> {
  return new Promise((resolve) => {
    child.once("close", (status, signal) => {
      resolve({ signal, status });
    });
  });
}
