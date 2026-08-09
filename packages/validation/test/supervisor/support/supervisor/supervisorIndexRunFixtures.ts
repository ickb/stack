import type { ChildProcess } from "node:child_process";
import {
  parseArgs,
  resolvePlan,
  supervise,
  type Dependencies,
} from "../../../../src/supervisor/index.ts";
import { captureWrites, pathToString } from "./supervisorIndexAssertions.ts";
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
  missingStat,
  noopAsync,
  realpathFixture,
  selectiveIgnoredChecker,
  spawnFixture,
  type TestSpawnOptions,
} from "./supervisorIndexProcessFixtures.ts";

export interface RecordedSupervisorSpawn {
  args: string[];
  env?: NodeJS.ProcessEnv;
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
  spawned: RecordedSupervisorSpawn[];
  writes: Map<string, string>;
}> {
  const writes = new Map<string, string>();
  const spawned: RecordedSupervisorSpawn[] = [];
  const args = parseArgs(argv);
  const plan = resolvePlan(args, "/repo", {
    spawnSyncCommand: ignoredChecker(true),
  });
  const exitCode = await supervise(args, plan, {
    actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
    skipBuiltRuntimeCheck: true,
    spawnCommand: spawnFixture((command, commandArgs, options) => {
      spawned.push({ args: commandArgs, env: options.env });
      return handler(commandArgs, options, command);
    }),
    spawnSyncCommand: ignoredChecker(true),
    lstat: missingStat,
    stat: missingStat,
    mkdir: noopAsync,
    realpath: realpathFixture((path) => pathToString(path)),
    ...captureWrites(writes),
    ...dependencies,
  });

  return { exitCode, spawned, writes };
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
  writes: Map<string, string>;
  kills: Array<{ pid: number; signal: NodeJS.Signals }>;
} {
  const writes = new Map<string, string>();
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
  const plan = resolvePlan(args, "/repo", {
    spawnSyncCommand: selectiveIgnoredChecker(
      new Set([outDir, BOT_CONFIG_PATH, TESTER_CONFIG_PATH]),
    ),
  });
  const child = fakeHangingChild();

  const run = supervise(args, plan, {
    actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
    skipBuiltRuntimeCheck: true,
    commandKillGraceMs,
    killProcess: (pid: number, signal: NodeJS.Signals) => {
      kills.push({ pid, signal });
      if (signal === "SIGKILL") {
        queueMicrotask(() => {
          child.emit("close", null, "SIGKILL");
        });
      }
    },
    spawnCommand: spawnFixture((_command: string, commandArgs: string[]) =>
      isPreflightCommand(commandArgs) ? fakeSuccessfulPreflightChild() : child,
    ),
    spawnSyncCommand: ignoredChecker(true),
    lstat: missingStat,
    stat: missingStat,
    mkdir: noopAsync,
    realpath: realpathFixture((path) => pathToString(path)),
    ...captureWrites(writes),
  });

  return { run, writes, kills };
}
