import assert from "node:assert/strict";
import test from "node:test";
import {
  type SpawnedCommand,
  artifactRefSlot00,
  botEvent,
  botSourceCommand,
  childFixture,
  eventsSlot00File,
  eventsSlot01File,
  isRecord,
  join,
  launchAt,
  launchesFile,
  logRootOption,
  makeDirectory,
  parseArgs,
  pathMode,
  processIdentityFixture,
  readLaunches,
  readText,
  resolve,
  resolveLauncherPaths,
  rm,
  rootDir,
  runBotLauncher,
  runLauncher,
  selectRunLogs,
  stderrSlot00File,
  tempDir,
  writeBotEventScript,
  writeText,
} from "./support.ts";

const noChildTee = "--no-child-tee";
const nodeInputModule = "--input-type=module";

void test("parses launcher arguments without legacy module flags", () => {
  assert.deepEqual(
    parseArgs([logRootOption, "var/bot-log", "--", process.execPath, botSourceCommand]),
    {
      command: process.execPath,
      commandArgs: [botSourceCommand],
      logDir: undefined,
      logRoot: "var/bot-log",
      teeChildOutput: true,
    },
  );
  assert.deepEqual(parseArgs([noChildTee]), {
    command: undefined,
    commandArgs: [],
    logDir: undefined,
    logRoot: undefined,
    teeChildOutput: false,
  });
});

void test("resolves log paths inside the configured root", () => {
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- This test resolves strings only and does not access /tmp.
  const root = resolve("/tmp/ickb-stack");
  assert.deepEqual(
    resolveLauncherPaths({ cliLogRoot: "cli-log", envLogRoot: "env-log", root }),
    {
      logDir: join(root, "cli-log", "bot"),
      logRoot: join(root, "cli-log"),
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

void test("writes valid bot NDJSON, stderr, and launch metadata to separate files", async () => {
  const dir = await tempDir();
  try {
    const event = botEvent("first", { amount: "1" });
    const result = runLauncher(
      dir,
      [],
      [
        "-e",
        String.raw`${writeBotEventScript("first", { amount: "1" })} process.stderr.write('stderr-1\n');`,
      ],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, event);
    assert.equal(result.stderr, "stderr-1\n");

    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), event);
    assert.equal(await readText(join(logDir, stderrSlot00File)), "stderr-1\n");
    assert.equal(await pathMode(join(logDir, eventsSlot00File)), 0o600);
    assert.equal(await pathMode(join(logDir, launchesFile)), 0o600);
    for (const line of (await readText(join(logDir, eventsSlot00File)))
      .trim()
      .split("\n")) {
      const parsed: unknown = JSON.parse(line);
      assert.ok(isRecord(parsed));
      assert.equal(parsed.version, 1);
      assert.equal(parsed["app"], "bot");
      assert.match(String(parsed.type), /^bot\./u);
    }

    const launches = await readLaunches(logDir);
    assert.equal(launches.length, 2);
    const started = launchAt(launches, 0);
    assert.deepEqual(started.logSlot, {
      index: 0,
      count: 16,
      name: "slot-00",
    });
    assert.equal(started.version, 3);
    assert.match(String(started.runId), /^[\w.:-]{1,128}$/u);
    assert.equal(started.identity?.launcher?.pid, started.pid);
    assert.equal(started.identity?.child?.pid, started.childPid);
    assert.match(String(started.identity?.bootId), /\S/u);
    assert.match(String(started.identity?.launcher?.startTimeTicks), /^\d+$/u);
    assert.match(String(started.identity?.child?.startTimeTicks), /^\d+$/u);
    assert.deepEqual(launchAt(launches, 1).identity, started.identity);
    assert.equal(launchAt(launches, 1).runId, started.runId);
    assert.equal(launchAt(launches, 1).status, 0);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("rejects non-event child stdout without persisting an invalid event line", async () => {
  const dir = await tempDir();
  try {
    const result = runLauncher(
      dir,
      [],
      ["-e", String.raw`process.stdout.write('not-json\n');`],
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid event JSON/u);
    assert.equal(await readText(join(dir, "bot", eventsSlot00File)), "");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("reuses sixteen fixed run slots by truncating the selected slot", async () => {
  const dir = await tempDir();
  try {
    for (let index = 0; index < 17; index += 1) {
      const result = runLauncher(
        dir,
        [],
        ["-e", writeBotEventScript(`run-${String(index)}`)],
      );
      assert.equal(result.status, 0, result.stderr);
    }
    const logDir = join(dir, "bot");
    assert.equal(await readText(join(logDir, eventsSlot00File)), botEvent("run-16"));
    assert.equal(await readText(join(logDir, eventsSlot01File)), botEvent("run-1"));
    assert.deepEqual((await selectRunLogs(logDir)).slot, {
      index: 1,
      count: 16,
      name: "slot-01",
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("keeps child output out of the parent streams when no-child-tee is set", async () => {
  const dir = await tempDir();
  try {
    const event = botEvent("quiet");
    const result = runLauncher(
      dir,
      [noChildTee],
      [
        "-e",
        String.raw`${writeBotEventScript("quiet")} process.stderr.write('stderr\n');`,
      ],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(await readText(join(dir, "bot", eventsSlot00File)), event);
    assert.equal(await readText(join(dir, "bot", stderrSlot00File)), "stderr\n");
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("uses the source bot as the default one-shot child command", async () => {
  const dir = await tempDir();
  try {
    let spawned: SpawnedCommand | undefined;
    const result = await runBotLauncher({
      argv: [logRootOption, dir],
      env: { BOT_RUN_ID: "inherited-run-id" },
      now: () => new Date("2026-01-02T03:04:05.006Z"),
      root: rootDir,
      readProcessIdentity: processIdentityFixture,
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
    const spawnedEnv = spawned.options.env;
    assert.ok(spawnedEnv !== undefined);
    assert.equal(
      spawnedEnv["BOT_ARTIFACT_ROOT"],
      join(dir, "bot", "artifacts", "slot-00"),
    );
    assert.equal(spawnedEnv["BOT_ARTIFACT_REF_PREFIX"], artifactRefSlot00);
    const expectedRunId = `2026-01-02T03:04:05.006Z-${process.pid.toString(36)}`;
    assert.equal(spawnedEnv["BOT_RUN_ID"], expectedRunId);
    const launches = await readLaunches(join(dir, "bot"));
    assert.equal(launchAt(launches, 0).version, 3);
    assert.equal(launchAt(launches, 0).runId, expectedRunId);
    assert.equal(launchAt(launches, 1).version, 3);
    assert.equal(launchAt(launches, 1).runId, expectedRunId);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("resets per-slot artifacts when a fixed run slot is reused", async () => {
  const dir = await tempDir();
  try {
    const first = runLauncher(dir, [], ["-e", writeBotEventScript("first")]);
    assert.equal(first.status, 0, first.stderr);
    const staleDir = join(dir, "bot", "artifacts", "slot-00", "ringSegments");
    const stalePath = join(staleDir, "stale.json");
    await makeDirectory(staleDir, { recursive: true });
    await writeText(stalePath, "stale\n");

    for (let index = 1; index < 17; index += 1) {
      const result = runLauncher(
        dir,
        [],
        ["-e", writeBotEventScript(`fill-${String(index)}`)],
      );
      assert.equal(result.status, 0, result.stderr);
    }
    await assert.rejects(async () => readText(stalePath), /ENOENT/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("refuses a symlink substituted before active log reopen", async () => {
  const dir = await tempDir();
  try {
    const eventsPath = join(dir, "bot", eventsSlot00File);
    const script = `
      const { symlink, unlink } = await import('node:fs/promises');
      await unlink(${JSON.stringify(eventsPath)});
      await symlink('/dev/null', ${JSON.stringify(eventsPath)});
      process.stdout.write(${JSON.stringify(botEvent("symlink", { payload: "x".repeat(1000) }))});
      await new Promise((resolve) => setTimeout(resolve, 1000));
    `;
    const result = runLauncher(dir, [noChildTee], [nodeInputModule, "-e", script]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /symlinked managed log path/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
