import assert from "node:assert/strict";
import test from "node:test";
import {
  LogSink,
  PassThrough,
  Writable,
  assertLauncherOutputHidesCanary,
  canaryPrivateKey,
  childFixture,
  copyBytes,
  eventsSlot00File,
  eventsSlot01File,
  join,
  lastLaunch,
  linkSymbolic,
  logRootOption,
  readLaunches,
  readText,
  rm,
  rootDir,
  runBotLauncher,
  runLauncher,
  stderrSlot00File,
  tempDir,
  writeText,
} from "./support.ts";

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
        String.raw`process.stdout.write('event\n'); process.stderr.write('stderr\n'); process.exit(2);`,
      ],
      root: rootDir,
      stderr: failingTee,
      stdout: failingTee,
    });

    assert.deepEqual(result, { status: 2 });
    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), "event\n");
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
      spawnProcess() {
        const child = childFixture();
        queueMicrotask((): void => {
          child.emit("error", new Error("spawn ENOENT"));
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
  });

  const write = sink.write("event\n");

  await assert.rejects(write, /disk full/u);
  await assert.rejects(sink.close(), /disk full/u);
  assert.equal(closed, true);
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
