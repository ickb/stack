import { describe, expect, it, vi } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_MATCH_COMMITTED,
  CLASSIFICATION_SUITE,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  SCENARIO_FLAG,
  TARGET_OUTCOME_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  fakeChild,
  fakeHangingChild,
  ignoredChecker,
  jsonArtifact,
  readArtifacts,
  recordAt,
  resolveTestPlan,
  spawnFixture,
  startHangingBotSupervisorRun,
} from "../../support/supervisor/index.ts";

describe(CLASSIFICATION_SUITE, () => {
  it("kills timed-out actor commands after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const { run, plan, started, kills } = startHangingBotSupervisorRun({
        outDir: "log/live-supervisor/timeout-kill-test",
        commandTimeoutSeconds: "1",
        commandKillGraceMs: 10,
      });

      await started;
      await vi.advanceTimersByTimeAsync(1010);

      await expect(run).resolves.toBe(2);
      const writes = readArtifacts(plan);
      expect(kills).toEqual([
        { pid: -1234, signal: "SIGTERM" },
        { pid: -1234, signal: "SIGKILL" },
      ]);
      expect(
        writes.get(
          "/repo/log/live-supervisor/timeout-kill-test/cycle-0001-incident.json",
        ),
      ).toContain("command_timeout");
      const command = jsonArtifact(
        writes,
        "/repo/log/live-supervisor/timeout-kill-test/cycle-0001-bot.command.json",
      );
      expect(recordAt(command.command, "command artifact command")).toMatchObject({
        timeoutMs: 1000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not spawn commands when the remaining wall-clock budget is too small", async () => {
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/wall-clock-timeout-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_CYCLES_FLAG,
      "1",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "900",
    ]);
    const plan = resolveTestPlan(args, { spawnSyncCommand: ignoredChecker(true) });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      now: () => 0,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeHangingChild();
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([]);
    expect(
      jsonArtifact(
        writes,
        "/repo/log/live-supervisor/wall-clock-timeout-test/summary.json",
      ),
    ).toMatchObject({ stopped: "max_wall_clock_seconds" });
    expect(
      writes.has(
        "/repo/log/live-supervisor/wall-clock-timeout-test/cycle-0001-bot.command.json",
      ),
    ).toBe(false);
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not spawn actor commands when wall-clock expires at the command boundary", async () => {
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/wall-clock-boundary-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_CYCLES_FLAG,
      "1",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, { spawnSyncCommand: ignoredChecker(true) });
    const clock = [0, 999, 1000, 1000];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      now: () => clock.shift() ?? 1000,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild("should not run");
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([]);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/wall-clock-boundary-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "max_wall_clock_seconds" });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("finalizes the same wall-clock decision when the clock moves backwards", async () => {
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/non-monotonic-wall-clock-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_CYCLES_FLAG,
      "1",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1000",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "900",
    ]);
    const plan = resolveTestPlan(args, { spawnSyncCommand: ignoredChecker(true) });
    const clock = [0, 0, 200_000, 0];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      now: () => clock.shift() ?? 0,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeChild("should not run");
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([]);
    expect(clock).toEqual([0]);
    expect(
      jsonArtifact(
        writes,
        "/repo/log/live-supervisor/non-monotonic-wall-clock-test/summary.json",
      ),
    ).toMatchObject({ stopped: "max_wall_clock_seconds" });
  });
});
