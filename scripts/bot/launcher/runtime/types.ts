import type { SpawnOptions } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";

export type ParsedLauncherArgs =
  | { help: true }
  | {
      command?: string;
      commandArgs: string[];
      help?: false;
      logDir?: string;
      logRoot?: string;
      logStorageQuotaBytes?: number;
      teeChildOutput: boolean;
    };

export interface LauncherPathsOptions {
  cliLogRoot?: string;
  envLogRoot?: string;
  logDir?: string;
  root: string;
}

export type LauncherResult =
  { signal?: undefined; status: number } | { signal: NodeJS.Signals; status?: undefined };

export interface ChildResult {
  error?: Error;
  signal: NodeJS.Signals | null;
  status: number | null;
}

export interface ChildLike {
  exitCode: number | null;
  killed: boolean;
  kill: (signal?: NodeJS.Signals | number) => boolean | undefined;
  once: {
    (
      event: "close",
      listener: (status: number | null, signal: NodeJS.Signals | null) => void,
    ): ChildLike;
    (event: "error", listener: (error: Error) => void): ChildLike;
  };
  pid?: number;
  stderr: Readable | null;
  stdout: Readable | null;
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildLike;

export interface OutputStream {
  off?: (event: "error", listener: (error?: Error | null) => void) => OutputStream;
  once?: (event: "error", listener: (error?: Error | null) => void) => OutputStream;
  write: (
    chunk: string | Uint8Array,
    callback?: (error?: Error | null) => void,
  ) => boolean | undefined;
}

export interface RunBotLauncherOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  root?: string;
  spawnProcess?: SpawnProcess;
  stderr?: OutputStream;
  stdout?: OutputStream;
}

export interface LogFiles {
  artifacts: string;
  events: string;
  launches: string;
  stderr: string;
}

export interface RunLogSlot {
  count: number;
  index: number;
  name: string;
}

export interface RunLogs {
  artifactRefPrefix: string;
  logFiles: LogFiles;
  slot: RunLogSlot;
}

export interface LogSinkLike {
  close: () => Promise<void>;
  write: (chunk: string | Uint8Array) => Promise<void>;
  writeLine: (record: unknown) => Promise<void>;
}

export interface LogSinks {
  events: LogSinkLike;
  launches: LogSinkLike;
  stderr: LogSinkLike;
}

export interface ManagedRunItem {
  kind: "directory" | "file";
  path: string;
}

export interface ManagedRunGroup {
  items: ManagedRunItem[];
  mtimeMs: number;
  size: number;
  slotName: string;
}

export type LogSinkHandle = Pick<FileHandle, "appendFile" | "close">;

export interface LauncherContext {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  root: string;
  spawnProcess: SpawnProcess;
  stderr: OutputStream;
  stdout: OutputStream;
}

export interface PreparedLaunch {
  child: ChildLike;
  childCommand: SafeCommandShape;
  childResultPromise: Promise<ChildResult>;
  packageInfo: PackageInfo | null;
  paths: { logDir: string; logRoot: string };
  removeSignalHandlers: () => void;
  root: string;
  runLogs: RunLogs;
  storageQuotaBytes?: number;
}

export interface PreparedLaunchConfig {
  packageInfo: PackageInfo | null;
  paths: { logDir: string; logRoot: string };
  root: string;
  runLogs: RunLogs;
  sinks: LogSinks;
  storageQuotaBytes?: number;
}

export interface SafeCommandShape {
  argumentCount: number;
  arguments: Array<{ index: number; value: string }>;
  executable: string;
}

export interface LaunchRecordInput {
  child: ChildLike;
  childCommand: SafeCommandShape;
  elapsedMs: number;
  now: () => Date;
  packageInfo: PackageInfo | null;
  parsed: Exclude<ParsedLauncherArgs, { help: true }>;
  paths: { logDir: string; logRoot: string };
  root: string;
  runLogs: RunLogs;
  signal: NodeJS.Signals | null;
  status: number | null;
  storageQuotaBytes?: number;
  type: string;
}

export interface LaunchRecordShape {
  app: "bot-launcher";
  childPid: number | null;
  command: SafeCommandShape;
  elapsedMs: number;
  logDir: string;
  logFiles: LogFiles;
  logRoot: string;
  logRetention: { storageQuotaBytes: number | null };
  logSlot: RunLogSlot;
  nodeVersion: string;
  package: PackageInfo | null;
  pid: number;
  repoRoot: string;
  signal: NodeJS.Signals | null;
  status: number | null;
  teeChildOutput: boolean;
  timestamp: string;
  type: string;
  version: 1;
}

export interface ExitLaunchRecordInput {
  childResult: ChildResult;
  copyResult: unknown;
  elapsedMs: number;
  launch: PreparedLaunch;
  now: () => Date;
  parsed: Exclude<ParsedLauncherArgs, { help: true }>;
}

export interface FailLaunchInput {
  child?: ChildLike;
  error: unknown;
  removeSignalHandlers?: () => void;
  sinks?: LogSinks;
  stderr: OutputStream;
}

export interface CopyChunkInput {
  chunk: string | Uint8Array;
  fileSink: Pick<LogSinkLike, "write">;
  pending: Promise<void>;
  readable: Readable;
  reject: (reason?: unknown) => void;
  tee?: OutputStream;
}

export interface HistoricalLaunchRecord {
  logSlot?: {
    count?: unknown;
    index?: unknown;
  };
  type?: unknown;
}

export interface PackageInfo {
  name: string | null;
  version: string | null;
}
