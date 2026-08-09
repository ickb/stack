import { runProcess, type ProcessRunnerDependencies } from "@ickb/node-utils";
import process from "node:process";
import {
  DEFAULT_COMMAND_KILL_GRACE_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
} from "../shared/supervisorConstants.ts";
import type {
  CommandResult,
  Dependencies,
  RunCommandSpec,
} from "../shared/supervisorTypes.ts";

export {
  assertBuiltRuntime,
  prepareOutputDirectory,
} from "../../artifacts/supervisorOutputDirectory.ts";

export async function runCommand(
  spec: RunCommandSpec,
  dependencies: Dependencies,
): Promise<CommandResult> {
  const start = now(dependencies);
  const result = await runProcess(
    spec.command,
    spec.args,
    {
      cwd: spec.cwd,
      env: spec.env ?? {},
      detached: process.platform !== "win32",
      timeoutMs: spec.timeoutMs,
      killSignal: "SIGTERM",
      killGraceMs: dependencies.commandKillGraceMs ?? DEFAULT_COMMAND_KILL_GRACE_MS,
      maxOutputBytes: dependencies.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      signalContext: dependencies.processSignalContext,
    },
    processRunnerDependencies(dependencies),
  );
  return commandResultFromFinish(
    spec,
    start,
    {
      status: result.status,
      signal: result.signal,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      ...(result.error === undefined ? {} : { spawnError: errorText(result.error) }),
    },
    dependencies,
  );
}

function commandResultFromFinish(
  spec: RunCommandSpec,
  start: number,
  result: Omit<CommandResult, "actor" | "command" | "args" | "elapsedMs" | "timeoutMs">,
  dependencies: Dependencies,
): CommandResult {
  return {
    actor: spec.actor,
    command: spec.command,
    args: spec.args,
    elapsedMs: now(dependencies) - start,
    timeoutMs: spec.timeoutMs,
    ...result,
  };
}

export function now(dependencies: Dependencies): number {
  return dependencies.now?.() ?? Date.now();
}

export function padCycle(cycleIndex: number): string {
  return cycleIndex.toString().padStart(4, "0");
}

export function processRunnerDependencies(
  dependencies: Dependencies,
): ProcessRunnerDependencies {
  return {
    ...(dependencies.spawnCommand === undefined
      ? {}
      : { spawn: dependencies.spawnCommand }),
    ...(dependencies.killProcess === undefined
      ? {}
      : { killProcess: dependencies.killProcess }),
    ...(dependencies.processOn === undefined
      ? {}
      : { addSignalHandler: dependencies.processOn }),
    ...(dependencies.processOff === undefined
      ? {}
      : { removeSignalHandler: dependencies.processOff }),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
