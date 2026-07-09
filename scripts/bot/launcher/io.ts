import type { Readable } from "node:stream";

import { toError } from "./runtime/support.ts";
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
