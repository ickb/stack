import assert from "node:assert/strict";
import type { SpawnOptions } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import pathModule from "node:path";
import type { TestContext } from "node:test";
import {
  type BoundedCommandOptions,
  type BoundedCommandResult,
  decideNext,
  DEFAULT_CHILD_TIMEOUT_SECONDS,
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
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  INSPECTION_REQUIRED_EXIT_CODE,
  parseArgs,
  runSupervisorLoop,
  summarizeRun,
  summarySignature,
  usage,
};
export type { SummaryRecord };

export const { join } = pathModule;
const { resolve } = pathModule;
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
}): Promise<void> {
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
      spawnSync: supervisorSpawn(options.root, { commands, summary: summaryText() }),
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

/** A disposable repository root; the loop writes its real output tree under it. */
export async function tempRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ickb-loop-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * Fake child processes: prebuild commands succeed; the supervisor child writes
 * `summary.json` into its `--out-dir` when a summary is given and returns `result`.
 */
export function supervisorSpawn(
  root: string,
  options: {
    commands?: BoundedCommandInvocation[];
    summary?: string;
    result?: SpawnResultFixture;
  } = {},
): NonNullable<LoopDependencies["spawnSync"]> {
  return (command, args, spawnOptions): SpawnResultFixture => {
    options.commands?.push({ command, args, options: spawnOptions });
    if (command !== process.execPath) {
      return { status: 0 };
    }
    if (options.summary !== undefined) {
      const outDir = resolve(root, args[args.indexOf("--out-dir") + 1] ?? "");
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "summary.json"), options.summary);
    }
    return options.result ?? { status: 0 };
  };
}
