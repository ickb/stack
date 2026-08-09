import { describe, expect, it } from "vitest";
import { parseArgs, resolvePlan, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_PATH,
  BOT_MATCH_COMMITTED,
  SCENARIO_FLAG,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  fakeChild,
  missingStat,
  pathToString,
  selectiveIgnoredChecker,
  spawnFixture,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it("requires the live preflight script before live actor spawn", async () => {
    const args = parseArgs([
      "--out-dir",
      "log/live-supervisor/missing-build-test",
      SCENARIO_FLAG,
      "bot-only",
      TARGET_OUTCOME_FLAG,
      BOT_MATCH_COMMITTED,
    ]);
    const plan = resolvePlan(args, "/repo", {
      spawnSyncCommand: selectiveIgnoredChecker(
        new Set([
          "log/live-supervisor/missing-build-test",
          BOT_CONFIG_PATH,
          TESTER_CONFIG_PATH,
        ]),
      ),
    });
    let spawned = false;
    let createdOutputDirectory = false;

    await expect(
      supervise(args, plan, {
        actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
        existsSync: (path) => !pathToString(path).endsWith("scripts/live/preflight.ts"),
        spawnCommand: spawnFixture(() => {
          spawned = true;
          return fakeChild("");
        }),
        stat: missingStat,
        mkdir: async () => {
          createdOutputDirectory = true;
          await Promise.resolve();
        },
      }),
    ).rejects.toThrow("Missing built live preflight script: scripts/live/preflight.ts");
    expect(spawned).toBe(false);
    expect(createdOutputDirectory).toBe(false);
  });
});
