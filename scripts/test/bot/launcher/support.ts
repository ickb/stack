import assert from "node:assert/strict";
import { spawnSync, type SpawnOptions, type SpawnSyncReturns } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Stats } from "node:fs";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  symlink as fsSymlink,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { PassThrough, Writable, type Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  copyBytes,
  LogSink,
  parseArgs,
  resolveLauncherPaths,
  runBotLauncher,
  selectRunLogs,
} from "../../../bot/launcher/index.ts";
export {
  copyBytes,
  LogSink,
  parseArgs,
  PassThrough,
  resolveLauncherPaths,
  runBotLauncher,
  selectRunLogs,
  Writable,
};

export const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
export const { join, resolve } = path;
export const launcher = join(rootDir, "scripts", "bot", "launcher.ts");
export const canaryPrivateKey = `0x${"42".repeat(32)}`;
export const logRootOption = "--log-root";
export const logStorageQuotaOption = "--log-storage-quota-bytes";
export const botSourceCommand = "apps/bot/src/index.ts";
export const eventsSlot00File = "bot.events.slot-00.ndjson";
export const stderrSlot00File = "bot.stderr.slot-00.log";
export const eventsSlot01File = "bot.events.slot-01.ndjson";
export const launchesFile = "launches.ndjson";
export const artifactRefSlot00 = "artifacts/slot-00";

export interface SpawnedCommand {
  args: string[];
  command: string;
  options: SpawnOptions;
}

export interface LaunchRecord extends Record<string, unknown> {
  command?: { argumentCount?: unknown; arguments?: unknown; executable?: unknown };
  elapsedMs?: unknown;
  logDir?: unknown;
  logFiles?: unknown;
  logRoot?: unknown;
  logSlot?: unknown;
  package?: { name?: unknown };
  signal?: unknown;
  status?: unknown;
  teeChildOutput?: unknown;
  type?: unknown;
}

// eslint-disable-next-line unicorn/prefer-event-target -- runBotLauncher models Node child-process EventEmitter semantics.
export class FixtureChild extends EventEmitter {
  public exitCode: number | null = null;
  public killed = false;
  public readonly pid?: number;
  public readonly stderr: Readable | null = null;
  public readonly stdout: Readable | null = null;

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }

  public kill(): boolean {
    this.killed = true;
    return true;
  }
}
export async function assertLauncherOutputHidesCanary(
  dir: string,
  stdout: string | Buffer | null,
  stderr: string | Buffer | null,
): Promise<void> {
  const logDir = join(dir, "bot");
  const produced = [
    stdout,
    stderr,
    await readText(join(logDir, eventsSlot00File)),
    await readText(join(logDir, stderrSlot00File)),
    await readText(join(logDir, launchesFile)),
  ].join("\n");
  // eslint-disable-next-line security/detect-non-literal-regexp -- The canary is a fixed test secret used only to assert output redaction.
  assert.doesNotMatch(produced, new RegExp(canaryPrivateKey, "u"));
}

export async function tempDir(): Promise<string> {
  return mkdtemp(join("/tmp", "ickb-bot-launcher-"));
}

export function childFixture({ pid }: { pid?: number } = {}): FixtureChild {
  return new FixtureChild(pid);
}

export function runLauncher(
  logRoot: string,
  launcherArgs: string[],
  childArgs: string[],
  extraEnv: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [
      launcher,
      logRootOption,
      logRoot,
      ...launcherArgs,
      "--",
      process.execPath,
      ...childArgs,
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ...extraEnv,
      },
    },
  );
}

export function runLauncherBuffer(
  logRoot: string,
  launcherArgs: string[],
  childArgs: string[],
): SpawnSyncReturns<Buffer> {
  return spawnSync(
    process.execPath,
    [
      launcher,
      logRootOption,
      logRoot,
      ...launcherArgs,
      "--",
      process.execPath,
      ...childArgs,
    ],
    { cwd: rootDir },
  );
}

export async function readLaunches(logDir: string): Promise<LaunchRecord[]> {
  const text = await readText(join(logDir, launchesFile));
  return text.trim().split("\n").map(parseLaunchRecord);
}

export async function makeDirectory(
  directory: string,
  options: { recursive: true },
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test paths are temp dirs or repo-local launcher fixture paths.
  await fsMkdir(directory, options);
}

export async function readBytes(filePath: string): Promise<Buffer> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test paths are temp dirs or repo-local launcher fixture paths.
  return fsReadFile(filePath);
}

export async function readText(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test paths are temp dirs or repo-local launcher fixture paths.
  return fsReadFile(filePath, "utf8");
}

export async function statPath(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test paths are temp dirs or repo-local launcher fixture paths.
  return fsStat(filePath);
}

export async function pathMode(filePath: string): Promise<number> {
  return (await statPath(filePath)).mode & 0o777;
}

export async function writeText(filePath: string, data: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test paths are temp dirs or repo-local launcher fixture paths.
  await fsWriteFile(filePath, data);
}

export async function linkSymbolic(
  target: string,
  linkPath: string,
  type?: "dir" | "file" | "junction",
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Symlink tests intentionally create links inside their temp directory.
  await fsSymlink(target, linkPath, type);
}

export function basenameOfNode(): string | undefined {
  return process.execPath.split(/[\\/]/u).at(-1);
}

export function parseLaunchRecord(line: string): LaunchRecord {
  const parsed: unknown = JSON.parse(line);
  if (isRecord(parsed)) {
    return parsed;
  }
  throw new Error("Expected launcher record");
}

export function launchAt(launches: LaunchRecord[], index: number): LaunchRecord {
  const launch = launches[index];
  assert.ok(launch !== undefined);
  return launch;
}

export function lastLaunch(launches: LaunchRecord[]): LaunchRecord {
  const launch = launches.at(-1);
  assert.ok(launch !== undefined);
  return launch;
}

export function isRecord(value: unknown): value is LaunchRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export { rm };
