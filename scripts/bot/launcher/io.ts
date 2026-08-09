import type { Readable } from "node:stream";

import { isRecord, toError } from "./runtime/support.ts";
import type { CopyChunkInput, LogSinkLike, OutputStream } from "./runtime/types.ts";

export async function copyBytes(
  readable: Readable | null,
  fileSink: Pick<LogSinkLike, "write">,
  tee?: OutputStream,
): Promise<void> {
  if (readable === null) {
    return;
  }

  let pending = Promise.resolve();
  await new Promise<void>((resolve, reject) => {
    readable.on("data", (chunk: string | Uint8Array) => {
      readable.pause();
      pending = copyChunk({ chunk, fileSink, pending, readable, reject, tee });
    });
    readable.once("end", () => {
      void settlePendingCopy(pending, resolve, reject);
    });
    readable.once("error", reject);
  });
}

export async function copyBotEvents(
  readable: Readable | null,
  fileSink: Pick<LogSinkLike, "write">,
  tee?: OutputStream,
): Promise<void> {
  if (readable === null) {
    return;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  for await (const chunk of readable) {
    pending += decodeChunk(chunk, decoder);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      await writeBotEventLine(line, fileSink, tee);
    }
  }
  pending += decoder.decode();
  if (pending !== "") {
    await writeBotEventLine(pending, fileSink, tee);
  }
}

function decodeChunk(chunk: unknown, decoder: InstanceType<typeof TextDecoder>): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return decoder.decode(chunk, { stream: true });
  }
  throw new Error("Bot child stdout emitted an unsupported chunk");
}

export async function settleCopies(...copies: Array<Promise<void>>): Promise<unknown> {
  const results = await Promise.allSettled(copies);
  const failed = results.find((result) => result.status === "rejected");
  return failed?.reason;
}

async function copyChunk({
  chunk,
  fileSink,
  pending,
  readable,
  reject,
  tee,
}: CopyChunkInput): Promise<void> {
  try {
    await pending;
    await fileSink.write(chunk);
    if (tee !== undefined) {
      await writeToStream(tee, chunk);
    }
    readable.resume();
  } catch (error) {
    reject(error);
    readable.destroy(toError(error));
  }
}

async function settlePendingCopy(
  pending: Promise<void>,
  resolve: () => void,
  reject: (reason?: unknown) => void,
): Promise<void> {
  try {
    await pending;
    resolve();
  } catch (error) {
    reject(error);
  }
}

async function writeToStream(
  stream: OutputStream,
  chunk: string | Uint8Array,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      setImmediate(() => {
        stream.off?.("error", finish);
        resolve();
      });
    };

    stream.once?.("error", finish);
    try {
      stream.write(chunk, finish);
    } catch {
      finish();
    }
  });
}

async function writeBotEventLine(
  rawLine: string,
  fileSink: Pick<LogSinkLike, "write">,
  tee: OutputStream | undefined,
): Promise<void> {
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  assertVersionedBotEvent(line);
  const output = `${line}\n`;
  await fileSink.write(output);
  if (tee !== undefined) {
    await writeToStream(tee, output);
  }
}

function assertVersionedBotEvent(line: string): void {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Bot child stdout contained invalid event JSON");
  }
  if (!isRecord(value) || !isVersionedBotEvent(value)) {
    throw new Error("Bot child stdout contained an invalid versioned bot event");
  }
}

function isVersionedBotEvent(value: Record<string, unknown>): boolean {
  return [
    value["version"] === 1,
    value["app"] === "bot",
    isBotEventType(value["type"]),
    value["chain"] === "testnet" || value["chain"] === "mainnet",
    typeof value["runId"] === "string" && value["runId"] !== "",
    isIterationId(value["iterationId"]),
    typeof value["timestamp"] === "string" && isIsoTimestamp(value["timestamp"]),
  ].every(Boolean);
}

function isBotEventType(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("bot.");
}

function isIterationId(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value;
}
