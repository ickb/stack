import { setTimeout as sleep } from "node:timers/promises";
import {
  minimalProcessEnv,
  runBoundedCommand,
  type BoundedCommandOptions,
  type BoundedCommandResult,
} from "../loop.ts";
import { spawnSyncCommand } from "../loop/command.ts";
import type {
  DynamicLoopDependencies,
  JsonValue,
  TextCommandResult,
  TextWriter,
} from "./model.ts";

export async function runNode(
  commandArgs: readonly string[],
  root: string,
  dependencies: DynamicLoopDependencies,
  options: Pick<BoundedCommandOptions, "timeout">,
): Promise<TextCommandResult> {
  const result = await runBoundedCommand(
    process.execPath,
    commandArgs,
    {
      cwd: root,
      encoding: "utf8",
      env: minimalProcessEnv(process.env),
      maxBuffer: 1024 * 1024,
      killSignal: "SIGTERM",
      detached: true,
      ...options,
    },
    dependencies,
  );
  return {
    ...result,
    signal: result.signal ?? null,
    stdout: commandOutputToString(result.stdout),
    stderr: commandOutputToString(result.stderr),
  };
}

export function spawnErrorMessage(result: BoundedCommandResult): string | undefined {
  return result.error === undefined ? undefined : errorMessage(result.error);
}

function commandOutputToString(output: BoundedCommandResult["stdout"]): string {
  if (output === undefined) {
    return "";
  }
  return typeof output === "string" ? output : output.toString("utf8");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sleepMs(
  ms: number,
  dependencies: DynamicLoopDependencies,
): Promise<void> {
  if (dependencies.sleep !== undefined) {
    await dependencies.sleep(ms);
    return;
  }
  await sleep(ms);
}

export function writeJsonLine(stream: TextWriter, record: Record<string, unknown>): void {
  stream.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...record }, jsonReplacer)}\n`,
  );
}

export function jsonReplacer(_key: string, value: JsonValue): JsonValue | string {
  return typeof value === "bigint" ? value.toString() : value;
}

export function checkIgnored(
  root: string,
  relativePath: string,
  dependencies: DynamicLoopDependencies,
): boolean {
  if (dependencies.checkIgnored !== undefined) {
    return dependencies.checkIgnored(relativePath);
  }
  const result = spawnSyncCommand(
    dependencies,
    "git",
    ["-C", root, "check-ignore", "--", relativePath],
    {
      encoding: "utf8",
      env: minimalProcessEnv(process.env),
    },
  );
  return result.status === 0;
}
