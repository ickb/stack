import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  DETERMINISTIC_INCIDENT_SUITE,
  MAX_CYCLES_FLAG,
  SCENARIO_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TEST_ACTOR_ENTRYPOINTS,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  readArtifacts,
  resolveTestPlan,
  spawnFixture,
  txHash,
} from "../../support/supervisor/index.ts";
import { botCommitThenTerminalFailureStdout } from "./support.ts";

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("does not open a pending audit when commit evidence is classified terminal", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-terminal-classification-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(botCommitThenTerminalFailureStdout()),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-terminal-classification-test/cycle-0001-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "terminal_chain_rejection",
      terminal: true,
      txHashes: [txHash("99")],
    });
  });
});
