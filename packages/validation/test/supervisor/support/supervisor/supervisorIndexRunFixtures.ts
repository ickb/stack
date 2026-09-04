import type { ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseArgs,
  resolvePlan,
  supervise,
  type Dependencies,
  type ParsedArgs,
  type SupervisorPlan,
} from "../../../../src/supervisor/index.ts";
import { readArtifacts } from "./supervisorIndexAssertions.ts";
import {
  BOT_CONFIG_PATH,
  BOT_MATCH_COMMITTED,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  MAX_CYCLES_FLAG,
  MAX_WALL_CLOCK_SECONDS_FLAG,
  SCENARIO_FLAG,
  TARGET_OUTCOME_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  TESTER_CONFIG_PATH,
} from "./supervisorIndexConstants.ts";
import {
  fakeHangingChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  selectiveIgnoredChecker,
  spawnFixture,
  type TestSpawnOptions,
} from "./supervisorIndexProcessFixtures.ts";

const { join } = path;

export interface RecordedSupervisorSpawn {
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export function resolveTestPlan(
  args: ParsedArgs,
  dependencies: Dependencies = {},
): SupervisorPlan {
  return resolvePlan(args, mkdtempSync(join(tmpdir(), "ickb-supervisor-")), dependencies);
}

export async function runSupervisorFixture(
  argv: string[],
  handler: (
    commandArgs: string[],
    options: TestSpawnOptions,
    command: string,
  ) => ChildProcess,
  dependencies: Dependencies = {},
): Promise<{
  exitCode: number;
  plan: SupervisorPlan;
  spawned: RecordedSupervisorSpawn[];
  writes: Map<string, string>;
}> {
  const spawned: RecordedSupervisorSpawn[] = [];
  const args = parseArgs(argv);
  const plan = resolveTestPlan(args, {
    spawnSyncCommand: ignoredChecker(true),
  });
  const exitCode = await supervise(args, plan, {
    actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
    spawnCommand: spawnFixture((command, commandArgs, options) => {
      spawned.push({ args: commandArgs, env: options.env });
      return handler(commandArgs, options, command);
    }),
    spawnSyncCommand: ignoredChecker(true),
    ...dependencies,
  });

  return { exitCode, plan, spawned, writes: readArtifacts(plan) };
}

export function startHangingBotSupervisorRun({
  outDir,
  commandTimeoutSeconds,
  commandKillGraceMs,
  maxWallClockSeconds,
}: {
  outDir: string;
  commandTimeoutSeconds: string;
  commandKillGraceMs: number;
  maxWallClockSeconds?: string;
}): {
  run: Promise<number>;
  plan: SupervisorPlan;
  started: Promise<void>;
  kills: Array<{ pid: number; signal: NodeJS.Signals }>;
} {
  const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
  const args = parseArgs([
    "--out-dir",
    outDir,
    SCENARIO_FLAG,
    "bot-only",
    TARGET_OUTCOME_FLAG,
    BOT_MATCH_COMMITTED,
    MAX_CYCLES_FLAG,
    "1",
    ...(maxWallClockSeconds === undefined
      ? []
      : [MAX_WALL_CLOCK_SECONDS_FLAG, maxWallClockSeconds]),
    COMMAND_TIMEOUT_SECONDS_FLAG,
    commandTimeoutSeconds,
  ]);
  const plan = resolveTestPlan(args, {
    spawnSyncCommand: selectiveIgnoredChecker(
      new Set([outDir, BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
    ),
  });
  const child = fakeHangingChild();
  const { promise: started, resolve: markStarted } = Promise.withResolvers<undefined>();

  const run = supervise(args, plan, {
    actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
    commandKillGraceMs,
    killProcess: (pid: number, signal: NodeJS.Signals) => {
      kills.push({ pid, signal });
      if (signal === "SIGKILL") {
        queueMicrotask(() => {
          child.emit("close", null, "SIGKILL");
        });
      }
    },
    spawnCommand: spawnFixture((_command: string, commandArgs: string[]) => {
      if (isPreflightCommand(commandArgs)) {
        return fakeSuccessfulPreflightChild();
      }
      markStarted(undefined);
      return child;
    }),
    spawnSyncCommand: ignoredChecker(true),
  });

  return { run, plan, started, kills };
}
