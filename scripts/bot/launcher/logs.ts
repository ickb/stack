import { constants } from "node:fs";
import path from "node:path";

import {
  appendLogFileFlags,
  launchLogFileName,
  launcherStartedType,
  runLogSlotCount,
} from "./runtime/constants.ts";
import { ignoreError, isErrorCode, isRecord } from "./runtime/support.ts";
import type {
  FileLogSinkHandle,
  HistoricalLaunchRecord,
  LogSinkHandle,
  LogSinkLike,
  LogSinks,
  RunLogs,
} from "./runtime/types.ts";
import { safeLstat, safeOpen } from "./storage/filesystem.ts";

const maxLaunchTailBytes = 16 * 1024 * 1024;

export async function selectRunLogs(logDir: string): Promise<RunLogs> {
  const launches = path.join(logDir, launchLogFileName);
  const index = await nextRunLogSlot(launches);
  const slotName = formatRunLogSlot(index);
  return {
    artifactRefPrefix: `artifacts/${slotName}`,
    slot: { index, count: runLogSlotCount, name: slotName },
    logFiles: {
      artifacts: path.join(logDir, "artifacts", slotName),
      events: path.join(logDir, `bot.events.${slotName}.ndjson`),
      launches,
      stderr: path.join(logDir, `bot.stderr.${slotName}.log`),
    },
  };
}

interface ManagedLogSink {
  filePath: string;
  handle: FileLogSinkHandle;
}

export class LogSink implements LogSinkLike {
  private readonly handle: LogSinkHandle;
  private pending: Promise<void> = Promise.resolve();
  public readonly managed?: ManagedLogSink;

  constructor(handle: LogSinkHandle, managed?: ManagedLogSink) {
    this.handle = handle;
    this.managed = managed;
  }

  public async write(chunk: string | Uint8Array): Promise<void> {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const previous = this.pending;
    const operation = appendAfter(previous, this, data);
    this.pending = operation;
    await operation;
  }

  public async writeLine(record: unknown): Promise<void> {
    await this.write(`${JSON.stringify(record)}\n`);
  }

  public async truncate(): Promise<void> {
    await this.handle.truncate(0);
  }

  public async close(): Promise<void> {
    try {
      await this.pending;
    } finally {
      await this.handle.close();
    }
  }

  public async appendDirect(data: Buffer): Promise<void> {
    if (this.managed !== undefined) {
      await assertCurrentLogHandle(this.managed.filePath, this.managed.handle);
    }
    await this.handle.appendFile(data);
  }
}

export async function openLogSinks(runLogs: RunLogs): Promise<LogSinks> {
  const opened: LogSink[] = [];
  try {
    const events = await openLogSink(runLogs.logFiles.events);
    opened.push(events);
    const launches = await openLogSink(runLogs.logFiles.launches);
    opened.push(launches);
    const stderr = await openLogSink(runLogs.logFiles.stderr);
    opened.push(stderr);

    await events.truncate();
    await stderr.truncate();
    return { events, launches, stderr };
  } catch (error) {
    await Promise.allSettled(opened.map(async (sink) => sink.close()));
    throw error;
  }
}

export async function closeSinks(sinks: LogSinks): Promise<void> {
  await Promise.all([sinks.events.close(), sinks.launches.close(), sinks.stderr.close()]);
}

async function nextRunLogSlot(launchesPath: string): Promise<number> {
  const latest = await latestRunLogSlot(launchesPath);
  return latest === undefined ? 0 : (latest + 1) % runLogSlotCount;
}

async function latestRunLogSlot(filePath: string): Promise<number | undefined> {
  const text = await readExistingLogFile(filePath);
  if (text === undefined) {
    return undefined;
  }

  for (const line of text.trimEnd().split(/\r?\n/u).toReversed()) {
    const index = parseLaunchSlotIndex(line);
    if (index !== undefined) {
      return index;
    }
  }
  return undefined;
}

async function readExistingLogFile(filePath: string): Promise<string | undefined> {
  try {
    const stat = await safeLstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked log file path: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${filePath}`);
    }
    const length = Math.min(stat.size, maxLaunchTailBytes);
    const start = stat.size - length;
    const handle = await safeOpen(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      return start === 0 ? text : text.split(/\r?\n/u).slice(1).join("\n");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

function parseLaunchSlotIndex(line: string): number | undefined {
  if (line.trim() === "") {
    return undefined;
  }
  try {
    const record = parseHistoricalLaunchRecord(line);
    return validLaunchSlotIndex(record);
  } catch {
    return undefined;
  }
}

function parseHistoricalLaunchRecord(line: string): HistoricalLaunchRecord {
  const parsed: unknown = JSON.parse(line);
  return isRecord(parsed) ? parsed : {};
}

function validLaunchSlotIndex(record: HistoricalLaunchRecord): number | undefined {
  const { logSlot } = record;
  const index = logSlot?.index;
  if (
    record.type === launcherStartedType &&
    Number.isSafeInteger(index) &&
    typeof index === "number" &&
    logSlot?.count === runLogSlotCount &&
    index >= 0 &&
    index < runLogSlotCount
  ) {
    return index;
  }
  return undefined;
}

function formatRunLogSlot(index: number): string {
  return `slot-${String(index).padStart(2, "0")}`;
}

async function openLogSink(filePath: string): Promise<LogSink> {
  await assertLogFileTarget(filePath);

  const handle = await safeOpen(filePath, appendLogFileFlags, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${filePath}`);
    }
    await handle.chmod(0o600);
    return new LogSink(handle, { filePath, handle });
  } catch (error) {
    await ignoreError(handle.close());
    throw error;
  }
}

async function assertLogFileTarget(filePath: string): Promise<void> {
  try {
    const stat = await safeLstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked log file path: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${filePath}`);
    }
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function appendAfter(
  previous: Promise<void>,
  sink: LogSink,
  data: Buffer,
): Promise<void> {
  await previous;
  await sink.appendDirect(data);
}

async function assertCurrentLogHandle(
  filePath: string,
  handle: FileLogSinkHandle,
): Promise<void> {
  const [pathStat, handleStat] = await Promise.all([safeLstat(filePath), handle.stat()]);
  if (pathStat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked managed log path: ${filePath}`);
  }
  if (
    !pathStat.isFile() ||
    !handleStat.isFile() ||
    pathStat.dev !== handleStat.dev ||
    pathStat.ino !== handleStat.ino
  ) {
    throw new Error(`Managed log path changed outside the launcher: ${filePath}`);
  }
}
