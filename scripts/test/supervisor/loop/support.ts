import assert from "node:assert/strict";
import type { SpawnOptions } from "node:child_process";
import { lstat as fsLstat } from "node:fs/promises";
import pathModule from "node:path";
import {
  type BoundedCommandOptions,
  type BoundedCommandResult,
  decideNext,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE,
  DEFAULT_PREBUILD_TIMEOUT_SECONDS_VALUE,
  INSPECTION_REQUIRED_EXIT_CODE,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  type SummaryRecord,
  summarySignature,
  type SupervisorLoopDependencies,
  usage,
} from "../../../supervisor/loop.ts";
export {
  decideNext,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE,
  DEFAULT_PREBUILD_TIMEOUT_SECONDS_VALUE,
  INSPECTION_REQUIRED_EXIT_CODE,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  summarySignature,
  usage,
};
export type { SummaryRecord };

export const { join } = pathModule;
export const BACKOFF_SECONDS_FLAG = "--backoff-seconds";
export const CHILD_TIMEOUT_SECONDS_FLAG = "--child-timeout-seconds";
export const LOOP_TEST_OUT_ROOT = "log/live-supervisor/loop-test";
export const LIVE_RUN_OUT_DIR = "log/live-supervisor/run";
export const MAX_RUNS_FLAG = "--max-runs";
export const OUT_ROOT_FLAG = "--out-root";
export const SCENARIO_FLAG = "--scenario";
export const STABLE_LIMIT_FLAG = "--stable-limit";
export const STANDARD_SCENARIO = "standard-cycle";

export type SummaryFixture = SummaryRecord;

export interface TestOutput {
  text: string;
  write: (chunk: string | Uint8Array) => void;
}

export interface CommandInvocation {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

export interface BoundedCommandInvocation {
  command: string;
  args: readonly string[];
  options: BoundedCommandOptions;
}

export type AnyCommandInvocation = BoundedCommandInvocation | CommandInvocation;

export type LoopDependencies = SupervisorLoopDependencies;
export type SpawnResultFixture = BoundedCommandResult;

export function testOutput(): TestOutput {
  return {
    text: "",
    write(chunk): void {
      this.text += chunk.toString();
    },
  };
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing fixture item at index ${String(index)}`);
  }
  return item;
}

export function commandByName<T extends AnyCommandInvocation>(
  commands: readonly T[],
  commandName: string,
): T {
  const command = commands.find((item) => item.command === commandName);
  if (command === undefined) {
    throw new Error(`Missing command ${commandName}`);
  }
  return command;
}

export function commandEnv(
  command: AnyCommandInvocation,
): Record<string, string | undefined> {
  return command.options.env ?? {};
}

export function recordingSpawn(
  commands: BoundedCommandInvocation[],
): LoopDependencies["spawnSync"] {
  return (command, args, options): SpawnResultFixture => {
    commands.push({ command, args, options });
    return { status: 0 };
  };
}

export function summaryText(extra: SummaryFixture = {}): string {
  return JSON.stringify({
    stopped: "max_cycles",
    aggregateCounts: { bot_no_action_skip: 1 },
    txCreatingTxHashCount: 0,
    txCreatingOutcomeCount: 0,
    artifacts: [],
    ...extra,
  });
}

export async function assertValidationOutRootAccepted(options: {
  expectedOutDir: string;
  outputPattern: RegExp;
  outRoot: string;
  root: string;
  summaryPath: string;
}): Promise<void> {
  const reads = new Map<string, string>([[options.summaryPath, summaryText()]]);
  const commands: BoundedCommandInvocation[] = [];
  const output = testOutput();

  const exitCode = await runSupervisorLoop({
    argv: [
      OUT_ROOT_FLAG,
      options.outRoot,
      MAX_RUNS_FLAG,
      "1",
      "--",
      SCENARIO_FLAG,
      "bot-only",
    ],
    root: options.root,
    io: { stdout: output, stderr: output },
    dependencies: {
      ...freshLoopOutputDependencies(),
      spawnSync: recordingSpawn(commands),
      readFile: (filePath: string) => reads.get(filePath),
    },
  });

  assert.equal(exitCode, INSPECTION_REQUIRED_EXIT_CODE, output.text);
  const supervisorCommand = commandByName(commands, process.execPath);
  assert.deepEqual(supervisorCommand.args.slice(-4), [
    SCENARIO_FLAG,
    "bot-only",
    "--out-dir",
    options.expectedOutDir,
  ]);
  assert.match(output.text, options.outputPattern);
}

export function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function freshLoopOutputDependencies(
  existingPaths: string[] = [],
): LoopDependencies {
  const paths = new Set(existingPaths);
  return {
    mkdir: (filePath, options): void => {
      if (options?.recursive === true) {
        paths.add(filePath);
        return;
      }
      if (paths.has(filePath)) {
        throw errorWithCode("exists", "EEXIST");
      }
      paths.add(filePath);
    },
    lstat: async (filePath): Promise<{ isSymbolicLink: () => boolean }> => {
      if (paths.has(filePath)) {
        return { isSymbolicLink: (): boolean => false };
      }
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixture paths are validated supervisor roots or their existing ancestors.
      return fsLstat(filePath);
    },
  };
}
