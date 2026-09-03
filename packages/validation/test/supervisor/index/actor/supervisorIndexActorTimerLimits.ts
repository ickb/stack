import { describe, expect, it, vi } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_PATH,
  BOT_MATCH_COMMITTED,
  CLASSIFICATION_SUITE,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  PREFLIGHT_RETRYABLE_FAILURE,
  SCENARIO_FLAG,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  captureWrites,
  expectSupervisorSpawnCounts,
  fakeChild,
  ignoredChecker,
  jsonArtifact,
  missingStat,
  noopAsync,
  pathToString,
  realpathFixture,
  selectiveIgnoredChecker,
  spawnFixture,
  startHangingBotSupervisorRun,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("does not retry preflight after the wall-clock budget expires", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/preflight-retry-wall-clock-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_CYCLES_FLAG,
      "1",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "1",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/preflight-retry-wall-clock-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    const clock = [0, 0, 0, 0, 2000];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 2000,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild("", 1, PREFLIGHT_RETRYABLE_FAILURE);
      }),
      spawnSyncCommand: ignoredChecker(true),
      lstat: missingStat,
      stat: missingStat,
      mkdir: noopAsync,
      realpath: realpathFixture((path) => pathToString(path)),
      ...captureWrites(writes),
    });

    expect(exitCode).toBe(0);
    expectSupervisorSpawnCounts(spawned, { preflight: 1, actor: 0 });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/preflight-retry-wall-clock-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "max_wall_clock_seconds" });
    expect(
      writes.has(
        "/repo/log/live-supervisor/preflight-retry-wall-clock-test/cycle-0001-bot-preflight-attempt-1.command.json",
      ),
    ).toBe(true);
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("caps actor command timers to Node's maximum delay", async () => {
    vi.useFakeTimers();
    try {
      const maxTimerDelayMs = 2_147_483_647;
      const { run, writes, kills } = startHangingBotSupervisorRun({
        outDir: "log/live-supervisor/timeout-cap-test",
        commandTimeoutSeconds: String(maxTimerDelayMs),
        commandKillGraceMs: maxTimerDelayMs + 10,
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(maxTimerDelayMs - 1);
      expect(kills).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(kills).toEqual([{ pid: -1234, signal: "SIGTERM" }]);
      await vi.advanceTimersByTimeAsync(maxTimerDelayMs);

      await expect(run).resolves.toBe(2);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      expect(
        writes.get("/repo/log/live-supervisor/timeout-cap-test/cycle-0001-incident.json"),
      ).toContain("command_timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});
