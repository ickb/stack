import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";

import { closeSinks } from "../logs.ts";
import {
  terminationGraceMs as defaultTerminationGraceMs,
  launcherLockNamePrefix,
  signalNames,
} from "./constants.ts";
import { ignoreError, isErrorCode, publicErrorMessage } from "./support.ts";
import type {
  ChildLike,
  ChildResult,
  FailLaunchInput,
  LauncherLock,
  LauncherResult,
  OutputStream,
  SafeCommandShape,
} from "./types.ts";

export async function acquireLauncherLock(logDir: string): Promise<LauncherLock> {
  if (process.platform !== "linux") {
    throw new Error("Bot launcher locking requires Linux abstract Unix sockets");
  }

  const uid = String(process.getuid?.() ?? "nouid");
  const digest = createHash("sha256").update(logDir).digest("hex").slice(0, 32);
  const socketName = `\0${launcherLockNamePrefix}${uid}-${digest}`;
  const server = createServer((socket) => {
    socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      if (isErrorCode(error, "EADDRINUSE")) {
        reject(new Error("Bot log directory is already owned by another launcher"));
        return;
      }
      reject(
        new Error("Unable to acquire bot launcher Linux abstract socket lock", {
          cause: error,
        }),
      );
    };
    server.once("error", onError);
    server.listen(socketName, () => {
      server.off("error", onError);
      resolve();
    });
  });

  return { server };
}

export async function releaseLauncherLock(lock: LauncherLock): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    lock.server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function waitForChild(child: ChildLike): Promise<ChildResult> {
  return new Promise<ChildResult>((resolve) => {
    let childError: Error | undefined;
    child.once("error", (error: Error) => {
      childError = error;
    });
    child.once("close", (status, signal) => {
      resolve({ error: childError, signal, status });
    });
  });
}

export async function waitForChildClose(child: ChildLike): Promise<void> {
  return new Promise<void>((resolve) => {
    child.once("close", () => {
      resolve();
    });
  });
}

export function forwardSignalsTo(child: ChildLike): () => void {
  const handlers: Array<[NodeJS.Signals, () => void]> = signalNames.map((signal) => {
    const handler = (): void => {
      if (child.exitCode === null && !child.killed) {
        child.kill(signal);
      }
    };
    process.once(signal, handler);
    return [signal, handler];
  });
  return (): void => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}

export function safeCommandShape(
  command: string,
  argumentCount: number,
): SafeCommandShape {
  return {
    argumentCount,
    arguments: Array.from({ length: argumentCount }, (_, index) => ({
      index,
      value: "<omitted>",
    })),
    executable: path.basename(command),
  };
}

export function childResultToLauncherResult(
  childResult: ChildResult,
  copyResult: unknown,
  stderr: OutputStream,
): LauncherResult {
  if (copyResult !== undefined) {
    stderr.write(`ickb-bot-launcher: ${publicErrorMessage(copyResult)}\n`);
    return { status: 1 };
  }
  if (childResult.error !== undefined) {
    stderr.write(
      `ickb-bot-launcher: Failed to spawn child process: ${publicErrorMessage(childResult.error)}\n`,
    );
    return { status: 1 };
  }
  if (childResult.signal !== null) {
    return { signal: childResult.signal };
  }
  return { status: childResult.status ?? 1 };
}

export async function failLaunch({
  beforeClose,
  child,
  childClosePromise,
  error,
  lock,
  removeSignalHandlers,
  sinks,
  stderr,
  terminationGraceMs = defaultTerminationGraceMs,
}: FailLaunchInput): Promise<LauncherResult> {
  removeSignalHandlers?.();
  if (child !== undefined && childClosePromise !== undefined) {
    await terminateAndReapChild(child, childClosePromise, terminationGraceMs);
  }
  let evidenceError: unknown;
  try {
    await beforeClose?.();
  } catch (error_) {
    evidenceError = error_;
  }
  if (sinks !== undefined) {
    await ignoreError(closeSinks(sinks));
  }
  if (lock !== undefined) {
    await ignoreError(releaseLauncherLock(lock));
  }
  stderr.write(`ickb-bot-launcher: ${publicErrorMessage(error)}\n`);
  if (evidenceError !== undefined) {
    stderr.write(
      `ickb-bot-launcher: Failed to persist terminal launch evidence: ${publicErrorMessage(evidenceError)}\n`,
    );
  }
  return { status: 1 };
}

async function terminateAndReapChild(
  child: ChildLike,
  childClosePromise: Promise<void>,
  graceMs: number,
): Promise<void> {
  if (child.exitCode !== null) {
    await childClosePromise;
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // The close event remains the authoritative process lifecycle boundary.
  }

  let graceTimer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    closeObserved(childClosePromise),
    new Promise<false>((resolve) => {
      graceTimer = setTimeout(() => {
        resolve(false);
      }, graceMs);
    }),
  ]);
  if (graceTimer !== undefined) {
    clearTimeout(graceTimer);
  }
  if (closed) {
    return;
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // Await close even when kill races with process exit.
  }
  await childClosePromise;
}

async function closeObserved(childClosePromise: Promise<void>): Promise<true> {
  await childClosePromise;
  return true;
}
