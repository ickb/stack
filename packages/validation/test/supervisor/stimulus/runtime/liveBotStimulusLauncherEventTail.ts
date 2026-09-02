import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runLiveBotStimulusTest } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  LIVE_BOT_STIMULUS_SUITE,
  SUMMARY_JSON,
  TEST_SESSION,
  expectStimulusRunResult,
  launcherStartedRecord,
  liveBotStimulusDependencies,
  matchedCommitEventText,
  processIdentityFixture,
  testArgs,
  testBotIdentity,
  textWriter,
} from "../../support/stimulus/liveBotStimulus.ts";
import {
  MAX_EVENT_READ_BYTES,
  proveLiveLauncher,
  resolveSessionPaths,
} from "../../support/stimulus/liveBotStimulusRuntimeImports.ts";

const { join } = path;

it("reads launcher evidence through the native bounded path", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-launch-tail-"));
  const paths = resolveSessionPaths(
    testArgs({
      logRoot: tmpRoot,
      sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
    }),
    "/repo",
    {},
  );
  await mkdir(paths.botLogDir, { recursive: true });
  await writeFile(paths.launchesPath, `${JSON.stringify(launcherStartedRecord())}\n`);

  await expect(
    proveLiveLauncher(paths, { readProcessIdentity: processIdentityFixture }),
  ).resolves.toMatchObject({ runId: "run-1", pid: 100, childPid: 101 });

  await expect(
    proveLiveLauncher(paths, {
      readFile: async () => {
        await Promise.resolve();
        return `${"x".repeat(MAX_EVENT_READ_BYTES + 1)}\n${JSON.stringify(launcherStartedRecord())}\n`;
      },
      readProcessIdentity: processIdentityFixture,
    }),
  ).resolves.toMatchObject({ runId: "run-1", pid: 100, childPid: 101 });
});

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("tails the event file recorded by the current launcher run", async () => {
    const root = "/repo";
    const tmpRoot = await mkdtemp(join(tmpdir(), "ickb-live-bot-stimulus-test-"));
    const args = testArgs({
      logRoot: tmpRoot,
      sessionRoot: join(tmpRoot, "validation", TEST_SESSION),
      waitSeconds: 1,
      pollSeconds: 1,
    });
    const writes = new Map<string, string>();
    const appended = new Map<string, string>();
    const reads = new Map<string, string>();
    const legacyEventsPath = join(tmpRoot, "bot", "bot.events.ndjson");
    const slotEventsPath = join(tmpRoot, "bot", "bot.events.slot-05.ndjson");
    const launchesPath = join(tmpRoot, "bot", "launches.ndjson");
    reads.set(
      launchesPath,
      `${JSON.stringify(
        launcherStartedRecord({
          logFiles: {
            events: slotEventsPath,
            launches: launchesPath,
            stderr: join(tmpRoot, "bot", "bot.stderr.slot-05.log"),
          },
          logSlot: { index: 5, count: 16 },
        }),
      )}\n`,
    );
    const previousEventText = matchedCommitEventText("dd", "dd");
    const reactionEventText = matchedCommitEventText("ee", "cc");
    let eventText = previousEventText;

    await mkdir(path.dirname(slotEventsPath), { recursive: true });

    await writeFile(slotEventsPath, eventText);

    await writeFile(legacyEventsPath, "");
    const supervisorArgs: string[][] = [];
    const stdout = textWriter();

    const exitCode = await runLiveBotStimulusTest({
      root,
      args,
      io: { stdout, stderr: textWriter() },
      dependencies: liveBotStimulusDependencies({
        root,
        writes,
        appended,
        reads,
        setEventText: (text) => {
          eventText = text;

          writeFileSync(slotEventsPath, eventText);
        },
        previousEventText,
        reactionEventText,
        supervisorArgs,
        botIdentity: testBotIdentity({ maxRetryableAttempts: undefined }),
        botPreflightReportFields: { maxRetryableAttempts: undefined },
      }),
    });

    expect(exitCode).toBe(0);
    expectStimulusRunResult({
      tmpRoot,
      supervisorArgs,
      stdout,
      writes,
      appended,
    });
    expect(
      JSON.parse(
        writes.get(join(tmpRoot, "validation", TEST_SESSION, SUMMARY_JSON)) ?? "{}",
      ),
    ).toMatchObject({
      botEventsPath: slotEventsPath,
      result: { launcher: { botEventsPath: slotEventsPath } },
    });
  });
});
