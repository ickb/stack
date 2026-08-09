import { describe, expect, it, vi } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_PATH,
  BOT_DECISION_SKIPPED,
  CLASSIFICATION_SUITE,
  INCIDENT_CLASSIFICATION,
  MAX_CYCLES_FLAG,
  PREFLIGHT_RETRYABLE_FAILURE,
  SCENARIO_FLAG,
  SUMMARY_AGGREGATE_COUNTS,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  captureWrites,
  emptyActions,
  expectRetryablePreflightArtifacts,
  expectSupervisorSpawnCounts,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  missingStat,
  noopAsync,
  pathToString,
  realpathFixture,
  recordAt,
  selectiveIgnoredChecker,
  spawnFixture,
  startHangingBotSupervisorRun,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("keeps live-shaped hung commands classified as command timeouts", async () => {
    vi.useFakeTimers();
    try {
      const { run, writes, kills } = startHangingBotSupervisorRun({
        outDir: "log/live-supervisor/live-shaped-timeout-test",
        maxWallClockSeconds: "3600",
        commandTimeoutSeconds: "3600",
        commandKillGraceMs: 10,
      });

      await vi.advanceTimersByTimeAsync(3_600_010);

      await expect(run).resolves.toBe(2);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      const incident = jsonArtifact(
        writes,
        "/repo/log/live-supervisor/live-shaped-timeout-test/cycle-0001-incident.json",
      );
      expect(recordAt(incident.classification, INCIDENT_CLASSIFICATION)).toMatchObject({
        outcome: "command_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("retries retryable preflight transport failures once before actor execution", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    let preflightRuns = 0;
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/preflight-retry-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/preflight-retry-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        if (isPreflightCommand(commandArgs)) {
          preflightRuns += 1;
          return preflightRuns === 1
            ? fakeChild("", 1, PREFLIGHT_RETRYABLE_FAILURE)
            : fakeSuccessfulPreflightChild();
        }
        return fakeChild(
          JSON.stringify(
            botEvent(BOT_DECISION_SKIPPED, {
              reason: "no_actions",
              actions: emptyActions(),
            }),
          ),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
      lstat: missingStat,
      stat: missingStat,
      mkdir: noopAsync,
      realpath: realpathFixture((path) => pathToString(path)),
      ...captureWrites(writes),
    });

    expect(exitCode).toBe(0);
    expectRetryablePreflightArtifacts(spawned, writes);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/preflight-retry-test/summary.json",
    );
    expect(recordAt(summary.aggregateCounts, SUMMARY_AGGREGATE_COUNTS)).toMatchObject({
      bot_no_action_skip: 1,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("writes retryable-looking preflight output as public producer artifacts", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const preflightOutput = JSON.stringify({
      diagnostic: "public preflight output",
    });
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/preflight-unsafe-retry-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/preflight-unsafe-retry-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild(preflightOutput, 1, PREFLIGHT_RETRYABLE_FAILURE);
      }),
      spawnSyncCommand: ignoredChecker(true),
      lstat: missingStat,
      stat: missingStat,
      mkdir: noopAsync,
      realpath: realpathFixture((path) => pathToString(path)),
      ...captureWrites(writes),
    });

    expect(exitCode).toBe(2);
    expectSupervisorSpawnCounts(spawned, { preflight: 2, actor: 0 });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/preflight-unsafe-retry-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "preflight_retryable_error" });
    expect(recordAt(summary.aggregateCounts, SUMMARY_AGGREGATE_COUNTS)).toMatchObject({
      preflight_retryable_error: 1,
    });
    expect(
      writes.get(
        "/repo/log/live-supervisor/preflight-unsafe-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.json",
      ),
    ).toBe(`${preflightOutput}\n`);
    expect(
      writes.get(
        "/repo/log/live-supervisor/preflight-unsafe-retry-test/cycle-0001-bot-preflight-attempt-2.stdout.json",
      ),
    ).toBe(`${preflightOutput}\n`);
  });
});
