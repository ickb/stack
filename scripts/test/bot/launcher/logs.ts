import assert from "node:assert/strict";
import test from "node:test";
import {
  type SpawnedCommand,
  artifactRefSlot00,
  basenameOfNode,
  botSourceCommand,
  childFixture,
  eventsSlot00File,
  eventsSlot01File,
  join,
  launchAt,
  launchesFile,
  logRootOption,
  logStorageQuotaOption,
  makeDirectory,
  parseArgs,
  pathMode,
  readBytes,
  readLaunches,
  readText,
  resolve,
  resolveLauncherPaths,
  rm,
  rootDir,
  runBotLauncher,
  runLauncher,
  runLauncherBuffer,
  selectRunLogs,
  statPath,
  stderrSlot00File,
  tempDir,
  writeText,
} from "./support.ts";

void test("parses launcher arguments", () => {
  assert.deepEqual(
    parseArgs([logRootOption, "var/bot-log", "--", process.execPath, botSourceCommand]),
    {
      command: process.execPath,
      commandArgs: [botSourceCommand],
      logDir: undefined,
      logRoot: "var/bot-log",
      logStorageQuotaBytes: undefined,
      teeChildOutput: true,
    },
  );
  assert.deepEqual(parseArgs([]), {
    command: undefined,
    commandArgs: [],
    logDir: undefined,
    logRoot: undefined,
    logStorageQuotaBytes: undefined,
    teeChildOutput: true,
  });
  assert.deepEqual(parseArgs([logStorageQuotaOption, "123", "--no-child-tee"]), {
    command: undefined,
    commandArgs: [],
    logDir: undefined,
    logRoot: undefined,
    logStorageQuotaBytes: 123,
    teeChildOutput: false,
  });

  assert.throws(
    () => parseArgs([logRootOption, "--", process.execPath]),
    /Missing value for --log-root/u,
  );
  assert.throws(() => parseArgs([logStorageQuotaOption, "0"]), /positive integer/u);
});

void test("resolves explicit log root before runtime env and keeps log dirs contained", () => {
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- This test only resolves path strings and never accesses /tmp.
  const root = resolve("/tmp/ickb-stack");
  assert.deepEqual(
    resolveLauncherPaths({
      cliLogRoot: "cli-log",
      envLogRoot: "env-log",
      root,
    }),
    {
      logDir: join(root, "cli-log", "bot"),
      logRoot: join(root, "cli-log"),
    },
  );

  assert.deepEqual(
    resolveLauncherPaths({
      envLogRoot: "env-log",
      root,
    }),
    {
      logDir: join(root, "env-log", "bot"),
      logRoot: join(root, "env-log"),
    },
  );

  assert.throws(
    () =>
      resolveLauncherPaths({
        cliLogRoot: join(root, "log"),
        logDir: join(root, "outside"),
        root,
      }),
    /inside the resolved log root/u,
  );
});

void test("writes stdout, stderr, and launch metadata to separate append-only files", async () => {
  const dir = await tempDir();
  try {
    const first = runLauncher(
      dir,
      [],
      [
        "-e",
        String.raw`process.stdout.write('event-1\n'); process.stderr.write('stderr-1\n');`,
      ],
    );
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, "event-1\n");
    assert.equal(first.stderr, "stderr-1\n");

    const second = runLauncher(
      dir,
      [],
      [
        "-e",
        String.raw`process.stdout.write('event-2\n'); process.stderr.write('stderr-2\n');`,
      ],
    );
    assert.equal(second.status, 0, second.stderr);

    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), "event-1\n");
    assert.equal(await readText(join(logDir, stderrSlot00File)), "stderr-1\n");
    assert.equal(await readText(join(logDir, eventsSlot01File)), "event-2\n");
    assert.equal(await readText(join(logDir, "bot.stderr.slot-01.log")), "stderr-2\n");
    assert.equal(await pathMode(join(logDir, eventsSlot00File)), 0o600);
    assert.equal(await pathMode(join(logDir, stderrSlot00File)), 0o600);
    assert.equal(await pathMode(join(logDir, launchesFile)), 0o600);

    const launches = await readLaunches(logDir);
    assert.equal(launches.length, 4);
    const firstLaunch = launchAt(launches, 0);
    const childExit = launchAt(launches, 1);
    const secondLaunch = launchAt(launches, 2);
    assert.equal(firstLaunch.type, "launcher.started");
    assert.equal("network" in firstLaunch, false);
    assert.deepEqual(firstLaunch.logSlot, { index: 0, count: 16, name: "slot-00" });
    assert.deepEqual(firstLaunch.logFiles, {
      artifacts: join(logDir, "artifacts", "slot-00"),
      events: join(logDir, eventsSlot00File),
      launches: join(logDir, launchesFile),
      stderr: join(logDir, stderrSlot00File),
    });
    assert.equal(firstLaunch.status, null);
    assert.equal(firstLaunch.signal, null);
    assert.equal(firstLaunch.elapsedMs, 0);
    const firstCommand = firstLaunch.command;
    assert.ok(firstCommand !== undefined);
    assert.equal(firstCommand.executable, basenameOfNode());
    assert.equal(firstCommand.argumentCount, 2);
    assert.deepEqual(firstCommand.arguments, [
      { index: 0, value: "<omitted>" },
      { index: 1, value: "<omitted>" },
    ]);
    assert.equal(childExit.type, "launcher.child.exited");
    assert.equal(childExit.status, 0);
    assert.equal(childExit.signal, null);
    assert.equal(childExit.logRoot, dir);
    assert.equal(childExit.logDir, logDir);
    assert.equal(childExit.package?.name, "@ickb/bot-cli");
    assert.deepEqual(secondLaunch.logSlot, { index: 1, count: 16, name: "slot-01" });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("copies stdout and stderr bytes without rewriting", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncherBuffer(
      dir,
      [],
      [
        "-e",
        "process.stdout.write(Buffer.from([0, 255, 10])); process.stderr.write(Buffer.from([1, 254, 10]));",
      ],
    );
    assert.equal(result.status, 0, result.stderr.toString("utf8"));
    assert.deepEqual(result.stdout, Buffer.from([0, 255, 10]));
    assert.deepEqual(result.stderr, Buffer.from([1, 254, 10]));

    const logDir = join(dir, "bot");
    assert.deepEqual(
      await readBytes(join(logDir, eventsSlot00File)),
      Buffer.from([0, 255, 10]),
    );
    assert.deepEqual(
      await readBytes(join(logDir, stderrSlot00File)),
      Buffer.from([1, 254, 10]),
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("reuses fixed run log slots by truncating the selected slot", async () => {
  const dir = await tempDir();
  try {
    for (let index = 0; index < 17; index += 1) {
      const result = runLauncher(
        dir,
        [],
        [
          "-e",
          String.raw`process.stdout.write('event-${String(index)}\n'); process.stderr.write('stderr-${String(index)}\n');`,
        ],
      );
      assert.equal(result.status, 0, result.stderr);
    }

    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), "event-16\n");
    assert.equal(await readText(join(logDir, stderrSlot00File)), "stderr-16\n");
    assert.equal(await readText(join(logDir, eventsSlot01File)), "event-1\n");
    assert.deepEqual((await selectRunLogs(logDir)).slot, {
      index: 1,
      count: 16,
      name: "slot-01",
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("can keep child output out of systemd tee while writing files", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(
      dir,
      ["--no-child-tee"],
      [
        "-e",
        String.raw`process.stdout.write('event\n'); process.stderr.write('stderr\n');`,
      ],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");

    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), "event\n");
    assert.equal(await readText(join(logDir, stderrSlot00File)), "stderr\n");
    const launches = await readLaunches(logDir);
    assert.equal(launchAt(launches, 0).teeChildOutput, false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("uses the source bot as the default child command", async () => {
  const dir = await tempDir();
  try {
    let spawned: SpawnedCommand | undefined;
    const result = await runBotLauncher({
      argv: [logRootOption, dir],
      root: rootDir,
      spawnProcess(command, args, options) {
        spawned = { args, command, options };
        const child = childFixture({ pid: 1234 });
        queueMicrotask((): void => {
          child.emit("close", 0, null);
        });
        return child;
      },
    });

    assert.deepEqual(result, { status: 0 });
    assert.ok(spawned !== undefined);
    assert.equal(spawned.command, process.execPath);
    assert.deepEqual(spawned.args, [botSourceCommand]);
    assert.equal(spawned.options.cwd, rootDir);
    assert.ok(spawned.options.env !== undefined);
    assert.equal(
      spawned.options.env["BOT_ARTIFACT_ROOT"],
      join(dir, "bot", "artifacts", "slot-00"),
    );
    assert.equal(spawned.options.env["BOT_ARTIFACT_REF_PREFIX"], artifactRefSlot00);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("passes per-slot artifact root to child", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(
      dir,
      [],
      [
        "-e",
        `process.stdout.write(\`\${process.env.BOT_ARTIFACT_REF_PREFIX} \${process.env.BOT_ARTIFACT_ROOT.endsWith('/${artifactRefSlot00}')}\\n\`);`,
      ],
    );
    assert.equal(result.status, 0, result.stderr);

    const logDir = join(dir, "bot");
    assert.equal(
      await readText(join(logDir, eventsSlot00File)),
      `${artifactRefSlot00} true\n`,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("resets artifact directories when a run slot is reused", async () => {
  const dir = await tempDir();
  try {
    const first = runLauncher(dir, [], ["-e", ""]);
    assert.equal(first.status, 0, first.stderr);
    const staleArtifactDir = join(dir, "bot", "artifacts", "slot-00", "ringSegments");
    const staleArtifactPath = join(staleArtifactDir, `sha256-${"a".repeat(64)}.json`);
    await makeDirectory(staleArtifactDir, { recursive: true });
    await writeText(staleArtifactPath, "stale\n");

    for (let index = 1; index < 17; index += 1) {
      const result = runLauncher(dir, [], ["-e", ""]);
      assert.equal(result.status, 0, result.stderr);
    }

    await assert.rejects(async () => readText(staleArtifactPath), /ENOENT/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("storage quota prunes inactive run slots and artifact dirs", async () => {
  const dir = await tempDir();
  try {
    for (let index = 0; index < 3; index += 1) {
      const result = runLauncher(
        dir,
        [logStorageQuotaOption, "900"],
        ["-e", String.raw`process.stdout.write('${"x".repeat(500)}\n');`],
      );
      assert.equal(result.status, 0, result.stderr);
    }

    const logDir = join(dir, "bot");
    await assert.rejects(async () => readText(join(logDir, eventsSlot00File)), /ENOENT/u);
    assert.equal(
      await readText(join(logDir, "bot.events.slot-02.ndjson")),
      `${"x".repeat(500)}\n`,
    );
    assert.equal((await statPath(join(logDir, launchesFile))).isFile(), true);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("storage quota ignores stale bytes in the slot selected for truncation", async () => {
  const dir = await tempDir();
  try {
    const logDir = join(dir, "bot");
    await makeDirectory(logDir, { recursive: true });
    await writeText(
      join(logDir, launchesFile),
      `${JSON.stringify({
        app: "bot-launcher",
        type: "launcher.started",
        logSlot: { index: 15, count: 16, name: "slot-15" },
      })}\n`,
    );
    await writeText(join(logDir, eventsSlot00File), `${"x".repeat(1_000)}\n`);
    await writeText(join(logDir, stderrSlot00File), `${"x".repeat(1_000)}\n`);
    await writeText(join(logDir, eventsSlot01File), "keep\n");

    const result = runLauncher(
      dir,
      [logStorageQuotaOption, "500"],
      ["-e", String.raw`process.stdout.write('current\n');`],
    );
    assert.equal(result.status, 0, result.stderr);

    assert.equal(await readText(join(logDir, eventsSlot00File)), "current\n");
    assert.equal(await readText(join(logDir, eventsSlot01File)), "keep\n");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("storage quota can be configured from the launcher environment", async () => {
  const dir = await tempDir();
  try {
    for (let index = 0; index < 3; index += 1) {
      const result = runLauncher(
        dir,
        [],
        ["-e", String.raw`process.stdout.write('${"x".repeat(500)}\n');`],
        { ICKB_BOT_LOG_STORAGE_QUOTA_BYTES: "900" },
      );
      assert.equal(result.status, 0, result.stderr);
    }

    const logDir = join(dir, "bot");
    await assert.rejects(async () => readText(join(logDir, eventsSlot00File)), /ENOENT/u);
    assert.equal(
      await readText(join(logDir, "bot.events.slot-02.ndjson")),
      `${"x".repeat(500)}\n`,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
