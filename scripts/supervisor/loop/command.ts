import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import {
  minimalProcessEnv,
  runProcess,
  signalExitCode,
  type ProcessRunnerDependencies,
} from "../../../packages/node-utils/src/index.ts";
import {
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  PREBUILD_COMMANDS,
  TIMEOUT_KILL_GRACE_MS,
  type BoundedCommandOptions,
  type BoundedCommandResult,
  type PrebuildResult,
  type SupervisorLoopDependencies,
} from "./model.ts";

const DEFAULT_PREBUILD_TIMEOUT_SECONDS = DEFAULT_CHILD_TIMEOUT_SECONDS;

export async function prebuildRuntime(
  root: string,
  dependencies: SupervisorLoopDependencies,
): Promise<PrebuildResult> {
  for (const step of PREBUILD_COMMANDS) {
    const result = await runBoundedCommand(
      step.command,
      step.args,
      {
        cwd: root,
        env: minimalProcessEnv(process.env),
        stdio: "ignore",
        timeout: DEFAULT_PREBUILD_TIMEOUT_SECONDS * 1000,
        killSignal: "SIGTERM",
        killAfterTimeout: TIMEOUT_KILL_GRACE_MS,
        detached: true,
      },
      dependencies,
    );
    const status = typeof result.status === "number" ? result.status : 1;
    if (status !== 0) {
      return { ...step, status, signal: result.signal, error: result.error };
    }
  }
  return { status: 0 };
}

export async function runBoundedCommand(
  command: string,
  args: readonly string[],
  options: BoundedCommandOptions,
  dependencies: SupervisorLoopDependencies = {},
): Promise<BoundedCommandResult> {
  if (dependencies.spawnSync !== undefined) {
    return dependencies.spawnSync(command, args, options);
  }
  const {
    encoding,
    killAfterTimeout,
    killSignal,
    maxBuffer,
    stdio,
    timeout,
    ...spawnOptions
  } = options;
  if (encoding !== undefined && encoding !== "utf8") {
    throw new Error(`Unsupported process output encoding: ${encoding}`);
  }
  const result = await runProcess(
    command,
    args,
    {
      ...spawnOptions,
      captureOutput: stdio !== "ignore",
      killGraceMs: killAfterTimeout,
      killSignal,
      maxOutputBytes: maxBuffer,
      timeoutMs: timeout,
    },
    processDependencies(dependencies),
  );
  return {
    ...result,
    status:
      result.forwardedSignal === undefined
        ? result.status
        : signalExitCode(result.forwardedSignal),
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function processDependencies(
  dependencies: SupervisorLoopDependencies,
): ProcessRunnerDependencies {
  return {
    ...(dependencies.spawn === undefined ? {} : { spawn: dependencies.spawn }),
    ...(dependencies.addSignalHandler === undefined
      ? {}
      : { addSignalHandler: dependencies.addSignalHandler }),
    ...(dependencies.removeSignalHandler === undefined
      ? {}
      : { removeSignalHandler: dependencies.removeSignalHandler }),
  };
}

export { minimalProcessEnv };

export function spawnSyncCommand(
  dependencies: SupervisorLoopDependencies,
  command: string,
  args: readonly string[],
  options: BoundedCommandOptions,
): BoundedCommandResult {
  if (dependencies.spawnSync !== undefined) {
    return dependencies.spawnSync(command, args, options);
  }
  const spawnOptions: SpawnSyncOptions = options;
  return spawnSync(command, [...args], spawnOptions);
}
