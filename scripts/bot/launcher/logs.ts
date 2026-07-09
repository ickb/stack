import path from "node:path";

import {
  appendLogFileFlags,
  launchLogFileName,
  launcherStartedType,
  runLogSlotCount,
  truncateLogFileFlags,
} from "./runtime/constants.ts";
import { ignoreError, isErrorCode, isRecord } from "./runtime/support.ts";
import type {
  HistoricalLaunchRecord,
  LogSinkHandle,
  LogSinkLike,
  LogSinks,
  RunLogs,
} from "./runtime/types.ts";
import { safeLstat, safeOpen, safeReadFile } from "./storage/filesystem.ts";

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

export class LogSink implements LogSinkLike {
  private readonly handle: LogSinkHandle;
  private pending: Promise<void> = Promise.resolve();

  constructor(handle: LogSinkHandle) {
    this.handle = handle;
  }

  public async write(chunk: string | Uint8Array): Promise<void> {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const previous = this.pending;
    this.pending = appendAfter(previous, this.handle, data);
    await this.pending;
  }

  public async writeLine(record: unknown): Promise<void> {
    await this.write(`${JSON.stringify(record)}\n`);
  }

  public async close(): Promise<void> {
    try {
      await this.pending;
    } finally {
      await this.handle.close();
    }
  }
}

export async function openLogSinks(runLogs: RunLogs): Promise<LogSinks> {
  return {
    events: await openLogSink(runLogs.logFiles.events, { truncate: true }),
    launches: await openLogSink(runLogs.logFiles.launches),
    stderr: await openLogSink(runLogs.logFiles.stderr, { truncate: true }),
  };
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
    return await safeReadFile(filePath, "utf8");
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

async function openLogSink(
  filePath: string,
  { truncate = false } = {},
): Promise<LogSink> {
  await assertLogFileTarget(filePath);

  const handle = await safeOpen(
    filePath,
    truncate ? truncateLogFileFlags : appendLogFileFlags,
    0o600,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Log file path is not a regular file: ${filePath}`);
    }
    await handle.chmod(0o600);
    return new LogSink(handle);
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
  handle: LogSinkHandle,
  data: Buffer,
): Promise<void> {
  await previous;
  await handle.appendFile(data);
}
