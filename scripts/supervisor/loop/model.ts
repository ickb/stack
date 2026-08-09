import type { SpawnOptions } from "node:child_process";
import type { ProcessChild } from "../../../packages/node-utils/src/index.ts";

export const DEFAULT_MAX_RUNS = 10;
export const DEFAULT_STABLE_LIMIT = 3;
export const DEFAULT_BACKOFF_SECONDS = 30;
export const DEFAULT_CHILD_TIMEOUT_SECONDS = 65 * 60;
export const TIMEOUT_KILL_GRACE_MS = 5000;
export const SUMMARY_TOKEN_PATTERN = /^[a-z][a-z0-9_]*$/u;
export const DEFAULT_SUPERVISOR_SCRIPT = "apps/validation/src/supervisor.ts";
export const SUPERVISOR_OUTPUT_ROOT = "log/live-supervisor";
export const INSPECTION_REQUIRED_EXIT_CODE = 3;
export const LOOP_OWNED_FLAGS = [
  "--out-root",
  "--max-runs",
  "--stable-limit",
  "--backoff-seconds",
  "--child-timeout-seconds",
  "--supervisor-script",
];
export const PREBUILD_COMMANDS = [
  { target: "source", command: "pnpm", args: ["live:check:source"] },
];
export const DEFAULT_PREBUILD_TOTAL_TIMEOUT_SECONDS_VALUE =
  DEFAULT_CHILD_TIMEOUT_SECONDS * PREBUILD_COMMANDS.length;

export type CommandOutput = string | Buffer;

export interface BoundedCommandResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: CommandOutput;
  stderr?: CommandOutput;
  error?: unknown;
}

export type BoundedCommandOptions = Omit<SpawnOptions, "killSignal" | "stdio"> & {
  encoding?: BufferEncoding;
  killAfterTimeout?: number;
  killSignal?: NodeJS.Signals;
  maxBuffer?: number;
  stdio?: NonNullable<SpawnOptions["stdio"]>;
  timeout?: number;
};

export type MaybePromise<T> = T | Promise<T>;
export interface TextWriter {
  write: (chunk: string | Uint8Array) => unknown;
}
interface SymbolicLinkStats {
  isSymbolicLink: () => boolean;
}
type SpawnCommand = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ProcessChild;
type SpawnSyncCommand = (
  command: string,
  args: readonly string[],
  options: BoundedCommandOptions,
) => BoundedCommandResult;
export type CountRecord = Record<string, number>;
export type JsonValue =
  boolean | null | number | string | { [key: string]: JsonValue } | JsonValue[];
export interface SummaryRecord {
  [key: string]: unknown;
  aggregateCounts?: unknown;
  artifacts?: unknown;
  coverage?: unknown;
  preflightState?: unknown;
  publicVsOwnedStateAssumptions?: unknown;
  scenarioAttempts?: unknown;
  skipReasons?: unknown;
  stopDiagnostics?: unknown;
  stopped?: unknown;
  testerOrderEvidence?: unknown;
  txCreatingOutcomeCount?: unknown;
  txCreatingTxHashCount?: unknown;
}
export interface RunSummaryInput {
  runIndex: number;
  relativeOutDir: string;
  status: number;
}
export interface SupervisorRun {
  runIndex: number;
  relativeOutDir: string;
  status: number;
  stopped: string;
  aggregateCounts: CountRecord;
  outcomes: string[];
  txCount: number;
  txCreatingOutcomeCount: number;
  hasTxCreatingOutcome: boolean;
  hasIncident: boolean;
  skipReasons: string[];
  stopDiagnosticReason?: string;
  publicState: Record<string, unknown> | null;
  signature: string;
  childError?: string;
  childSignal?: string;
}
export interface DecisionRun {
  status: number;
  hasIncident: boolean;
  txCount: number;
  hasTxCreatingOutcome?: boolean;
  outcomes: readonly string[];
  signature: string;
}
export type DecisionReason =
  | "continue"
  | "incident"
  | "max_runs"
  | "new_outcome"
  | "stable_no_progress"
  | "supervisor_nonzero"
  | "tx_observed";
export interface SupervisorDecision {
  action: "continue" | "stop";
  reason: DecisionReason;
  newOutcomes: string[];
  stableCount: number;
  exitCode: number;
}
export interface LoopArgs {
  help: boolean;
  outRoot?: string;
  maxRuns: number;
  stableLimit: number;
  backoffSeconds: number;
  childTimeoutSeconds: number;
  supervisorScript: string;
  supervisorArgs: string[];
}
interface SupervisorLoopIo {
  stdout?: TextWriter;
  stderr?: TextWriter;
}
export interface SupervisorLoopDependencies {
  addSignalHandler?: (signal: NodeJS.Signals, handler: () => void) => unknown;
  lstat?: (path: string) => MaybePromise<SymbolicLinkStats>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => MaybePromise<unknown>;
  now?: () => number;
  pid?: number;
  readFile?: (
    path: string,
    encoding: BufferEncoding,
  ) => MaybePromise<string | Buffer | undefined>;
  removeSignalHandler?: (signal: NodeJS.Signals, handler: () => void) => unknown;
  sleep?: (ms: number) => MaybePromise<unknown>;
  spawn?: SpawnCommand;
  spawnSync?: SpawnSyncCommand;
}
export interface RunSupervisorLoopInput {
  argv: readonly string[];
  root?: string;
  dependencies?: SupervisorLoopDependencies;
  io?: SupervisorLoopIo;
}
export interface SpawnSupervisorInput {
  root: string;
  supervisorScript: string;
  supervisorArgs: readonly string[];
  relativeOutDir: string;
  childTimeoutSeconds: number;
  dependencies: SupervisorLoopDependencies;
}
export interface SpawnSupervisorHelpInput {
  root: string;
  supervisorScript: string;
  supervisorArgs: readonly string[];
  dependencies: SupervisorLoopDependencies;
}
interface PrebuildCommand {
  target: string;
  command: string;
  args: string[];
}
export type PrebuildResult =
  | { status: 0 }
  | (PrebuildCommand & {
      status: number;
      signal?: NodeJS.Signals | null;
      error?: unknown;
    });
export type FormattablePrebuildFailure = Partial<PrebuildCommand> & {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: unknown;
};
export interface LoopOutRoot {
  absolutePath: string;
  relativePath: string;
}
export interface MissingSummaryInput {
  runIndex: number;
  relativeOutDir: string;
  status: number;
  error: unknown;
  spawnResult: BoundedCommandResult;
}
export interface SupervisorLoopRuntime {
  args: LoopArgs;
  dependencies: SupervisorLoopDependencies;
  outRoot: LoopOutRoot;
  root: string;
  stdout: TextWriter;
  supervisorScript: string;
}
export interface SupervisorLoopWriters {
  stderr: TextWriter;
  stdout: TextWriter;
}
export interface SupervisorLoopRunState {
  previousSignature?: string;
  priorOutcomes: Set<string>;
  stableCount: number;
}
export type SupervisorLoopIterationResult =
  | { kind: "continue"; decision: SupervisorDecision; run: SupervisorRun }
  | { kind: "return"; exitCode: number };
export interface ParsedLoopOption {
  index: number;
  values: Partial<LoopArgs>;
}
