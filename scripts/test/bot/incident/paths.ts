import assert from "node:assert/strict";
import test from "node:test";
import {
  botEvent,
  botEventsNdjson,
  botRunStarted,
  collectIncident,
  commonArgs,
  fixtureDate,
  join,
  linkSymbolic,
  logDirOption,
  logRootOption,
  rm,
  rootDir,
  sinceOption,
  tempDir,
  untilOption,
  windowSince,
  windowUntil,
  writeFixtureLogs,
  writeText,
} from "./support.ts";

void test("refuses log directories outside the resolved log root", async () => {
  const dir = await tempDir();
  try {
    await assert.rejects(
      async () =>
        collectIncident({
          argv: [
            logRootOption,
            join(dir, "root"),
            logDirOption,
            join(dir, "outside"),
            sinceOption,
            windowSince,
            untilOption,
            windowUntil,
          ],
          root: rootDir,
        }),
      /inside the resolved log root/u,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("refuses symlinked log roots and log directories", async () => {
  const dir = await tempDir();
  try {
    await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [],
      stderr: [],
    });
    const linkedRoot = join(dir, "linked-root");
    await linkSymbolic(dir, linkedRoot, "dir");
    await assert.rejects(
      async () =>
        collectIncident({
          argv: commonArgs(linkedRoot),
          now: fixtureDate,
          root: rootDir,
        }),
      /symlinked log root path/u,
    );

    const linkedLogDir = join(dir, "linked-log-dir");
    await linkSymbolic(join(dir, "bot"), linkedLogDir, "dir");
    await assert.rejects(
      async () =>
        collectIncident({
          argv: [
            logRootOption,
            dir,
            logDirOption,
            linkedLogDir,
            sinceOption,
            windowSince,
            untilOption,
            windowUntil,
          ],
          now: fixtureDate,
          root: rootDir,
        }),
      /symlinked log directory path/u,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

void test("refuses symlinked source logs and incident directory parents", async () => {
  const dir = await tempDir();
  try {
    const logDir = await writeFixtureLogs(dir, {
      events: [botEvent(windowSince, botRunStarted)],
      launches: [],
      stderr: [],
    });
    await rm(join(logDir, botEventsNdjson));
    await writeText(join(dir, "target-events"), botEvent(windowSince, botRunStarted));
    await linkSymbolic(join(dir, "target-events"), join(logDir, botEventsNdjson));

    await assert.rejects(
      async () =>
        collectIncident({
          argv: commonArgs(dir),
          now: fixtureDate,
          root: rootDir,
        }),
      /symlinked source log file/u,
    );

    await rm(join(logDir, botEventsNdjson));
    await writeText(join(logDir, botEventsNdjson), botEvent(windowSince, botRunStarted));
    await linkSymbolic(join(dir, "target-incidents"), join(logDir, "incidents"), "dir");

    await assert.rejects(
      async () =>
        collectIncident({
          argv: commonArgs(dir),
          now: fixtureDate,
          root: rootDir,
        }),
      /symlinked incident directory parent/u,
    );
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
