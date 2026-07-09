import path from "node:path";

import { closeSinks } from "../logs.ts";
import { signalNames } from "./constants.ts";
import { ignoreError, publicErrorMessage } from "./support.ts";
import type {
  ChildLike,
  ChildResult,
  FailLaunchInput,
  LauncherResult,
  OutputStream,
  SafeCommandShape,
} from "./types.ts";

export async function waitForChild(child: ChildLike): Promise<ChildResult> {
  return new Promise<ChildResult>((resolve) => {
    let settled = false;
    const settle = (result: ChildResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };
    child.once("error", (error: Error) => {
      settle({ error, signal: null, status: 1 });
    });
    child.once("close", (status, signal) => {
      settle({ signal, status });
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
  child,
  error,
  removeSignalHandlers,
  sinks,
  stderr,
}: FailLaunchInput): Promise<LauncherResult> {
  removeSignalHandlers?.();
  if (child?.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
  }
  if (sinks !== undefined) {
    await ignoreError(closeSinks(sinks));
  }
  stderr.write(`ickb-bot-launcher: ${publicErrorMessage(error)}\n`);
  return { status: 1 };
}
