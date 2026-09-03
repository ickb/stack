import { describe, expect, it } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import { commandTimeoutOrStop } from "../../../../src/supervisor/preflight/supervisorPreflightStep.ts";
import {
  BOT_CONFIG_PATH,
  BOT_DECISION_SKIPPED,
  BOT_MATCH_COMMITTED,
  CLASSIFICATION_SUITE,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  SCENARIO_FLAG,
  SUMMARY_AGGREGATE_COUNTS,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  captureWrites,
  emptyActions,
  expectSupervisorSpawnCounts,
  fakeChild,
  fakeHangingChild,
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
} from "../../support/supervisor/index.ts";

it("rejects a wall-clock stop race without finalized evidence", async () => {
  const outDir = "log/live-supervisor/wall-clock-race-test";
  const args = parseArgs([
    "--out-dir",
    outDir,
    MAX_WALL_CLOCK_SECONDS_FLAG,
    "1",
    COMMAND_TIMEOUT_SECONDS_FLAG,
    "1",
  ]);
  const plan = resolvePlan(args, "/repo", {
    spawnSyncCommand: selectiveIgnoredChecker(
      new Set([outDir, BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
    ),
  });
  const finalizedEvidence: number[] = [];

  await expect(
    commandTimeoutOrStop(
      plan,
      1000,
      { now: () => 999 },
      1,
      "preflight",
      async (): Promise<number | undefined> => {
        await Promise.resolve();
        return finalizedEvidence.at(0);
      },
    ),
  ).rejects.toThrow("Wall-clock stop evidence was not finalized");
});

describe(CLASSIFICATION_SUITE, () => {
  it("does not spend tiny positive wall-clock remainders on short-timeout commands", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/tiny-tail-test",
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
          "log/live-supervisor/tiny-tail-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    const clock = [0, 999];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 999,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeHangingChild();
      }),
      spawnSyncCommand: ignoredChecker(true),
      lstat: missingStat,
      stat: missingStat,
      mkdir: noopAsync,
      realpath: realpathFixture((path) => pathToString(path)),
      ...captureWrites(writes),
    });

    expect(exitCode).toBe(0);
    expect(spawned).toEqual([]);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/tiny-tail-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "max_wall_clock_seconds" });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("stops before preflight when remaining wall-clock cannot fund another command", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/wall-clock-tail-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "2",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "3600",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "3600",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/wall-clock-tail-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    let commandCount = 0;

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      now: () => (commandCount < 2 ? 0 : 3_585_000),
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        commandCount += 1;
        return isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
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
    expectSupervisorSpawnCounts(spawned, { preflight: 1, actor: 1 });
    expect(
      writes.has(
        "/repo/log/live-supervisor/wall-clock-tail-test/cycle-0002-bot-preflight.command.json",
      ),
    ).toBe(false);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/wall-clock-tail-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "max_wall_clock_seconds" });
    expect(recordAt(summary.aggregateCounts, SUMMARY_AGGREGATE_COUNTS)).toMatchObject({
      bot_no_action_skip: 1,
    });
  });
});

describe(CLASSIFICATION_SUITE, () => {
  it("explains when preflight consumes the actor wall-clock start budget", async () => {
    const writes = new Map<string, string>();
    const spawned: string[][] = [];
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/wall-clock-preflight-budget-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "900",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "900",
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/wall-clock-preflight-budget-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    const clock = [0, 0, 0, 0, 0, 65_000, 65_000];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      skipBuiltRuntimeCheck: true,
      now: () => clock.shift() ?? 65_000,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild("should not run");
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
      "/repo/log/live-supervisor/wall-clock-preflight-budget-test/summary.json",
    );
    expect(summary).toMatchObject({ stopped: "max_wall_clock_seconds" });
    expect(recordAt(summary.stopDiagnostics, "summary stop diagnostics")).toMatchObject({
      reason: "insufficient_wall_clock_command_budget",
      cycleIndex: 1,
      stage: "actor_start",
      remainingWallClockMs: 835000,
      requiredCommandStartBudgetMs: 840000,
      configuredCommandTimeoutMs: 900000,
      commandStartGraceMs: 60000,
      maxWallClockSeconds: 900,
    });
  });
});
