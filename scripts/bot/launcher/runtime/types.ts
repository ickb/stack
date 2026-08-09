import type { SpawnOptions } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import type { Server } from "node:net";
import type { Readable } from "node:stream";

type ReadProcessIdentity = (
  pid: number,
) => Promise<{ bootId: string; startTimeTicks: string }>;

export type ParsedLauncherArgs =
  | { help: true }
  | {
      command?: string;
      commandArgs: string[];
      help?: false;
      logDir?: string;
      logRoot?: string;
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

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildLike;

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
  readProcessIdentity?: ReadProcessIdentity;
  root?: string;
  spawnProcess?: SpawnProcess;
  stderr?: OutputStream;
  stdout?: OutputStream;
}

interface LogFiles {
  artifacts: string;
  events: string;
  launches: string;
  stderr: string;
}

interface RunLogSlot {
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

export interface LauncherLock {
  server: Server;
}

export type LogSinkHandle = Pick<FileHandle, "appendFile" | "close" | "truncate">;
export type FileLogSinkHandle = Pick<
  FileHandle,
  "appendFile" | "chmod" | "close" | "stat" | "truncate"
>;

export interface LauncherContext {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  readProcessIdentity: ReadProcessIdentity;
  root: string;
  spawnProcess: SpawnProcess;
  stderr: OutputStream;
  stdout: OutputStream;
}

export interface PreparedLaunch {
  child: ChildLike;
  childClosePromise: Promise<void>;
  childCommand: SafeCommandShape;
  childResultPromise: Promise<ChildResult>;
  identity?: LauncherIdentity;
  packageInfo: PackageInfo | null;
  paths: { logDir: string; logRoot: string };
  removeSignalHandlers: () => void;
  root: string;
  runId: string;
  runLogs: RunLogs;
}

export interface PreparedLaunchConfig {
  lock: LauncherLock;
  packageInfo: PackageInfo | null;
  paths: { logDir: string; logRoot: string };
  root: string;
  runLogs: RunLogs;
  sinks: LogSinks;
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
  identity: LauncherIdentity;
  now: () => Date;
  packageInfo: PackageInfo | null;
  parsed: Exclude<ParsedLauncherArgs, { help: true }>;
  paths: { logDir: string; logRoot: string };
  root: string;
  runId: string;
  runLogs: RunLogs;
  signal: NodeJS.Signals | null;
  status: number | null;
  type: string;
}

export interface LaunchRecordShape {
  app: "bot-launcher";
  childPid: number | null;
  command: SafeCommandShape;
  elapsedMs: number;
  identity: LauncherIdentity;
  logDir: string;
  logFiles: LogFiles;
  logRoot: string;
  logSlot: RunLogSlot;
  nodeVersion: string;
  package: PackageInfo | null;
  pid: number;
  repoRoot: string;
  runId: string;
  signal: NodeJS.Signals | null;
  status: number | null;
  teeChildOutput: boolean;
  timestamp: string;
  type: string;
  version: 3;
}

export interface LauncherIdentity {
  bootId: string;
  child: LauncherProcessIdentity;
  launcher: LauncherProcessIdentity;
}

interface LauncherProcessIdentity {
  pid: number;
  startTimeTicks: string;
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
  beforeClose?: () => Promise<void>;
  child?: ChildLike;
  childClosePromise?: Promise<void>;
  error: unknown;
  lock?: LauncherLock;
  removeSignalHandlers?: () => void;
  sinks?: LogSinks;
  stderr: OutputStream;
  terminationGraceMs?: number;
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
