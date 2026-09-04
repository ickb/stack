import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  BOT_DECISION_SKIPPED,
  BOT_MATCH_COMMITTED,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  DETERMINISTIC_INCIDENT_SUITE,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  SCENARIO_FLAG,
  STANDARD_CYCLE_SCENARIO,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  botEvent,
  emptyActions,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  readArtifacts,
  resolveTestPlan,
  spawnFixture,
} from "../../support/supervisor/index.ts";

const botNoActionSkipSpawnCommand = (): ReturnType<typeof spawnFixture> =>
  spawnFixture((_command: string, commandArgs: string[]) =>
    isPreflightCommand(commandArgs)
      ? fakeSuccessfulPreflightChild()
      : fakeChild(
          JSON.stringify(
            botEvent(BOT_DECISION_SKIPPED, {
              reason: "no_actions",
              actions: emptyActions(),
            }),
          ),
        ),
  );

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("does not start another command after the wall-clock budget expires mid-cycle", async () => {
    const spawned: string[][] = [];
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/mid-cycle-wall-clock-test",
      SCENARIO_FLAG,
      STANDARD_CYCLE_SCENARIO,
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });
    const clock = [0, 0, 0, 0, 0, 2000];

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      now: () => clock.shift() ?? 2000,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        spawned.push(commandArgs);
        return fakeSuccessfulPreflightChild();
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toContain("--config");
    expect(spawned[0]).not.toContain("--role");
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/mid-cycle-wall-clock-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "max_wall_clock_seconds",
      requestedOutcomes: [BOT_MATCH_COMMITTED],
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("echoes requested target outcomes once in the summary", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/target-outcome-echo-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      "bot_no_action_skip",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: botNoActionSkipSpawnCommand(),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/target-outcome-echo-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "max_cycles",
      requestedOutcomes: ["bot_no_action_skip", BOT_MATCH_COMMITTED],
      aggregateCounts: { bot_no_action_skip: 1 },
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("keeps successful preflight probes out of aggregate outcome counts", async () => {
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/preflight-summary-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      "bot_no_action_skip",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: botNoActionSkipSpawnCommand(),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/preflight-summary-test/summary.json",
    );
    expect(summary.aggregateCounts).toEqual({
      bot_no_action_skip: 1,
    });
  });
});
