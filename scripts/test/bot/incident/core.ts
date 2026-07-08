import assert from "node:assert/strict";
import test from "node:test";
import {
  assertWindowedBundleOutputs,
  assertWindowedBundleSummary,
  botDecisionSkipped,
  botEvent,
  botEventsNdjson,
  botRunStarted,
  botStderrLog,
  canaryPrivateKey,
  collectBundle,
  collector,
  commonArgs,
  fixtureDate,
  fixtureNow,
  join,
  launch,
  launcherStarted,
  launchesNdjson,
  logDirOption,
  logRootOption,
  mode,
  moduleDefaultFlag,
  openPath,
  parseArgs,
  parseTimeBound,
  readIncidentSummary,
  readText,
  readVersionJson,
  rm,
  rootDir,
  sinceOption,
  slot00EventsNdjson,
  slot00StderrLog,
  slot01EventsNdjson,
  slot01StderrLog,
  sourceSummary,
  spawnSync,
  splitReadHandle,
  summaryJson,
  tempDir,
  untilOption,
  versionJson,
  windowSince,
  windowUntil,
  windowedFixtureEvents,
  windowedFixtureLaunches,
  windowedFixtureStderr,
  writeFixtureLogs,
  writeFixtureSlotLogs,
} from "./support.ts";

void test("parses collector arguments and relative time bounds", () => {
  assert.deepEqual(
    parseArgs([logRootOption, "var/logs", sinceOption, "2h", untilOption, "now"]),
    {
      logRoot: "var/logs",
      since: "2h",
      until: "now",
    },
  );

  const now = new Date(fixtureNow);
  assert.equal(parseTimeBound("now", now).toISOString(), fixtureNow);
  assert.equal(parseTimeBound("2h", now).toISOString(), windowSince);
  assert.equal(parseTimeBound("2026-05-25T11:00:00Z", now).toISOString(), windowUntil);
  assert.throws(
    () => parseArgs([logRootOption, "var/logs", untilOption, "now"]),
    /Missing required --since/u,
  );
});

void test("collects a time-bounded source-separated incident bundle with summary counts", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: windowedFixtureEvents(),
      launches: windowedFixtureLaunches(),
      stderr: windowedFixtureStderr(),
    });

    const result = await collectBundle({
      argv: [logRootOption, dir, sinceOption, windowSince, untilOption, windowUntil],
      now: fixtureDate,
      root: rootDir,
    });

    assert.match(result.incidentDir, /\/incidents\/20260525T120000000Z-/u);
    assert.equal(await mode(result.incidentDir), 0o700);
    assert.equal(await mode(join(result.incidentDir, summaryJson)), 0o600);
    await assertWindowedBundleOutputs(result.incidentDir);
    await assertWindowedBundleSummary(result.incidentDir, logDir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("includes a bounded tail when stderr has no timestamps", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [],
      stderr: Array.from(
        { length: 205 },
        (_, index) => `stack line ${index.toString()}\n`,
      ),
    });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    const stderr = await readText(join(result.incidentDir, botStderrLog));
    assert.doesNotMatch(stderr, /^stack line 0$/mu);
    assert.match(stderr, /^stack line 5$/mu);
    assert.match(stderr, /^stack line 204$/mu);

    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(sourceSummary(summary, botStderrLog).selectedLines, 200);
    assert.equal(sourceSummary(summary, botStderrLog).selectedUndatedLines, 200);
    assert.equal(sourceSummary(summary, botStderrLog).undatedLines, 205);
    assert.equal(sourceSummary(summary, botStderrLog).undatedTailIncluded, true);
    assert.equal(sourceSummary(summary, botStderrLog).undatedTailLimit, 200);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("decodes source log UTF-8 across chunk boundaries", async () => {
  const dir = await tempDir();
  try {
    const marker = "snowman ☃";
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted, { marker })],
      launches: [],
      stderr: [],
    });
    const eventPath = join(logDir, botEventsNdjson);
    const bytes = Buffer.from(await readText(eventPath));
    const splitAt = bytes.indexOf(Buffer.from("☃")) + 1;

    const result = await collectBundle({
      argv: commonArgs(dir),
      dependencies: {
        async open(filePath: string, flags: number, fileMode?: number) {
          if (filePath === eventPath && typeof flags === "number") {
            return splitReadHandle(filePath, [
              bytes.subarray(0, splitAt),
              bytes.subarray(splitAt),
            ]);
          }
          return openPath(filePath, flags, fileMode);
        },
      },
      now: fixtureDate,
      root: rootDir,
    });

    const events = await readText(join(result.incidentDir, botEventsNdjson));
    assert.ok(events.includes(marker));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("collects ring-slot bot launcher log files", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureSlotLogs(dir, {
      eventSlots: {
        [slot00EventsNdjson]: [botEvent(windowSince, botRunStarted)],
        [slot01EventsNdjson]: [
          botEvent("2026-05-25T10:10:00.000Z", botDecisionSkipped, {
            reason: "no_actions",
          }),
        ],
      },
      launches: [
        launch(windowSince, launcherStarted, {
          logFiles: {
            events: join(dir, "bot", slot01EventsNdjson),
            launches: join(dir, "bot", launchesNdjson),
            stderr: join(dir, "bot", slot01StderrLog),
          },
          logSlot: { index: 1, count: 16 },
        }),
      ],
      stderrSlots: {
        [slot00StderrLog]: ["2026-05-25T10:05:00.000Z slot zero warning\n"],
        [slot01StderrLog]: ["2026-05-25T10:15:00.000Z slot one warning\n"],
      },
    });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    assert.equal(logDir, join(dir, "bot"));
    assert.match(
      await readText(join(result.incidentDir, slot00EventsNdjson)),
      /bot\.run\.started/u,
    );
    assert.match(
      await readText(join(result.incidentDir, slot01EventsNdjson)),
      /bot\.decision\.skipped/u,
    );
    assert.match(
      await readText(join(result.incidentDir, slot01StderrLog)),
      /slot one warning/u,
    );
    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(sourceSummary(summary, slot00EventsNdjson).included, true);
    assert.equal(sourceSummary(summary, slot01EventsNdjson).included, true);
    assert.equal(sourceSummary(summary, slot00StderrLog).included, true);
    assert.equal(sourceSummary(summary, slot01StderrLog).included, true);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("does not use undated stderr tail fallback when timestamped stderr is outside the window", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [],
      stderr: ["2026-05-25T09:00:00.000Z before window\n", "outside continuation\n"],
    });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });

    assert.equal(await readText(join(result.incidentDir, botStderrLog)), "");
    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(sourceSummary(summary, botStderrLog).timestampedLines, 1);
    assert.equal(sourceSummary(summary, botStderrLog).undatedLines, 1);
    assert.equal(sourceSummary(summary, botStderrLog).selectedLines, 0);
    assert.equal(sourceSummary(summary, botStderrLog).undatedTailIncluded, false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("accepts explicit contained log directory and environment log root", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [
        launch("2026-05-25T10:00:01.000Z", "launcher.child.exited", {
          status: 0,
        }),
      ],
      stderr: ["2026-05-25T10:00:02.000Z ok\n"],
    });

    const result = await collectBundle({
      argv: [
        logDirOption,
        logDir,
        sinceOption,
        windowSince,
        untilOption,
        "2026-05-25T10:00:02.000Z",
      ],
      envLogRoot: dir,
      now: fixtureDate,
      root: rootDir,
    });
    const summary = await readIncidentSummary(result.incidentDir);
    assert.equal(summary.logRoot, dir);
    assert.equal(summary.logRootSource, "env:ICKB_BOT_LOG_ROOT");
    assert.equal(summary.logDir, logDir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("includes selected producer log text without masking bundles", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [
        botEvent(windowSince, botRunStarted, {
          error: "public diagnostic",
        }),
      ],
      launches: [],
      stderr: [],
    });

    const result = await collectBundle({
      argv: commonArgs(dir),
      now: fixtureDate,
      root: rootDir,
    });
    const events = await readText(join(result.incidentDir, botEventsNdjson));
    assert.match(events, /public diagnostic/u);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("produced bundles do not contain configured canary secrets", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [launch(windowSince, launcherStarted)],
      stderr: [`${windowSince} public diagnostic\n`],
    });

    const result = spawnSync(
      process.execPath,
      [moduleDefaultFlag, collector, ...commonArgs(dir)],
      {
        cwd: rootDir,
        encoding: "utf8",
        env: {
          ...process.env,
          ICKB_TESTNET_BOT_PRIVATE_KEY: canaryPrivateKey,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(`${result.stdout}\n${result.stderr}`.includes(canaryPrivateKey), false);
    const incidentDir = /^Incident bundle directory: (.+)$/mu.exec(result.stdout)?.[1];
    assert.ok(incidentDir !== undefined && incidentDir !== "");

    const produced = [
      botEventsNdjson,
      botStderrLog,
      launchesNdjson,
      "README.txt",
      summaryJson,
      versionJson,
    ];
    const bundleText = (
      await Promise.all(produced.map(async (name) => readText(join(incidentDir, name))))
    ).join("\n");
    assert.equal(bundleText.includes(canaryPrivateKey), false);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("keeps collecting incidents when git metadata lookup fails", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [],
      stderr: [],
    });

    const result = await collectBundle({
      argv: commonArgs(dir),
      dependencies: {
        spawnSync() {
          throw new Error("git unavailable");
        },
      },
      now: fixtureDate,
      root: rootDir,
    });

    const version = await readVersionJson(result.incidentDir);
    assert.equal(version.gitCommit, null);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
