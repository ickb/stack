import { describe, expect, it } from "vitest";
import { parseArgs, supervise } from "../../../../src/supervisor/index.ts";
import {
  BOT_CONFIG_FLAG,
  BOT_CONFIG_PATH,
  BOT_ENTRYPOINT,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  DETERMINISTIC_INCIDENT_SUITE,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  SCENARIO_FLAG,
  STANDARD_CYCLE_SCENARIO,
  STOP_AFTER_TX_COUNT_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_CONFIG_PATH,
  TESTER_ENTRYPOINT,
  TEST_ACTOR_ENTRYPOINTS,
  expectNoIncident,
  fakeChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  jsonArtifact,
  readArtifacts,
  resolveTestPlan,
  spawnFixture,
  testerOrderStdout,
  txHash,
} from "../../support/supervisor/index.ts";
import {
  botCommitWithoutPostStateStdout,
  botDoubleCommitStdout,
  botIncompleteStateReadSkipStdout,
  botStateReadSkipStdout,
  botTerminalStopStdout,
} from "./support.ts";

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("waits for the next bot state read before stop-after-tx-count", async () => {
    let botRuns = 0;
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-stop-test",
      SCENARIO_FLAG,
      "bot-only",
      STOP_AFTER_TX_COUNT_FLAG,
      "1",
      MAX_CYCLES_FLAG,
      "2",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        botRuns += 1;
        return fakeChild(
          botRuns === 1
            ? botCommitWithoutPostStateStdout("90")
            : botStateReadSkipStdout(),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(botRuns).toBe(2);
    expectNoIncident(writes);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-stop-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 1,
      txCreatingOutcomeCount: 1,
      aggregateCounts: { bot_match_committed: 1, bot_no_action_skip: 1 },
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("uses a bot-only audit cycle after stop-after-tx-count in standard-cycle", async () => {
    const actorEntrypoints: string[] = [];
    let botRuns = 0;
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-standard-cycle-test",
      SCENARIO_FLAG,
      STANDARD_CYCLE_SCENARIO,
      STOP_AFTER_TX_COUNT_FLAG,
      "2",
      MAX_CYCLES_FLAG,
      "2",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        actorEntrypoints.push(commandArgs[0] ?? "");
        if (commandArgs[0] === TESTER_ENTRYPOINT) {
          return fakeChild(testerOrderStdout({ txByte: "93" }));
        }
        botRuns += 1;
        return fakeChild(
          botRuns === 1
            ? botCommitWithoutPostStateStdout("94")
            : botStateReadSkipStdout(),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(0);
    expect(actorEntrypoints).toEqual([TESTER_ENTRYPOINT, BOT_ENTRYPOINT, BOT_ENTRYPOINT]);
    expectNoIncident(writes);
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-standard-cycle-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "stop_after_tx_count",
      txCreatingTxHashCount: 2,
      txCreatingOutcomeCount: 2,
      aggregateCounts: {
        tester_order_created: 1,
        bot_match_committed: 1,
        bot_no_action_skip: 1,
      },
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("fails wall-clock stop with a committed bot transaction pending balance audit", async () => {
    const nowValues = [0, 0, 0, 0, 0, 0, 0, 0, 200];
    let nowIndex = 0;
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-wall-clock-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "2",
      MAX_WALL_CLOCK_SECONDS_FLAG,
      "1",
      COMMAND_TIMEOUT_SECONDS_FLAG,
      "1",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      now: () => nowValues[Math.min(nowIndex++, nowValues.length - 1)] ?? 200,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(botCommitWithoutPostStateStdout("95")),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-wall-clock-test/cycle-0001-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      txHashes: [txHash("95")],
    });
    expect(incident["suggestedNextAction"]).toBe(
      "inspect the incident bundle and run a review pass for material code changes before extended relaunch",
    );
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-wall-clock-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "malformed_evidence",
      aggregateCounts: { bot_match_committed: 1, malformed_evidence: 1 },
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("fails max-cycles with a committed bot transaction pending balance audit", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-pending-test",
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
          : fakeChild(botCommitWithoutPostStateStdout("91")),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-pending-test/cycle-0001-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      txHashes: [txHash("91")],
      reason:
        "bot committed transaction evidence was not followed by next-cycle balance evidence before supervisor stop",
    });
    const summary = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-pending-test/summary.json",
    );
    expect(summary).toMatchObject({
      stopped: "malformed_evidence",
      aggregateCounts: { bot_match_committed: 1, malformed_evidence: 1 },
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("fails pending bot balance audit on incomplete next state read", async () => {
    let botRuns = 0;
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-incomplete-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "2",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        botRuns += 1;
        return fakeChild(
          botRuns === 1
            ? botCommitWithoutPostStateStdout("92")
            : botIncompleteStateReadSkipStdout(),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-incomplete-test/cycle-0002-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      txHashes: [txHash("92")],
      reason: "bot next-cycle balance evidence was incomplete",
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("fails when one bot run commits again before auditing the prior commit", async () => {
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-double-commit-test",
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
          : fakeChild(botDoubleCommitStdout("96", "97")),
      ),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-double-commit-test/cycle-0001-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      txHashes: [txHash("96")],
      reason:
        "bot committed transaction evidence was not followed by next-cycle balance evidence",
    });
  });
});

describe(DETERMINISTIC_INCIDENT_SUITE, () => {
  it("fails when a terminal bot stop happens while balance audit is pending", async () => {
    let botRuns = 0;
    const args = parseArgs([
      BOT_CONFIG_FLAG,
      BOT_CONFIG_PATH,
      TESTER_CONFIG_FLAG,
      TESTER_CONFIG_PATH,
      "--out-dir",
      "log/live-supervisor/bot-balance-audit-terminal-stop-test",
      SCENARIO_FLAG,
      "bot-only",
      MAX_CYCLES_FLAG,
      "2",
    ]);
    const plan = resolveTestPlan(args, {
      spawnSyncCommand: ignoredChecker(true),
    });

    const exitCode = await supervise(args, plan, {
      actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
      spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
        if (isPreflightCommand(commandArgs)) {
          return fakeSuccessfulPreflightChild();
        }
        botRuns += 1;
        return fakeChild(
          botRuns === 1 ? botCommitWithoutPostStateStdout("98") : botTerminalStopStdout(),
        );
      }),
      spawnSyncCommand: ignoredChecker(true),
    });
    const writes = readArtifacts(plan);

    expect(exitCode).toBe(2);
    const incident = jsonArtifact(
      writes,
      "/repo/log/live-supervisor/bot-balance-audit-terminal-stop-test/cycle-0002-incident.json",
    );
    expect(incident.classification).toMatchObject({
      outcome: "malformed_evidence",
      terminal: true,
      txHashes: [txHash("98")],
      reason:
        "bot committed transaction evidence was not followed by next-cycle balance evidence before terminal actor stop",
    });
  });
});
