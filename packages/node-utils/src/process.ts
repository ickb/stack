import { spawn, type SpawnOptions } from "node:child_process";

const DEFAULT_KILL_GRACE_MS = 5000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const PROCESS_GROUP_EXIT_POLL_MS = 10;
const PROCESS_GROUP_EXIT_WAIT_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM"] as const;

interface ReadableLike {
  on: (event: "data", listener: (chunk: Buffer) => void) => unknown;
}

export interface ProcessChild {
  pid?: number;
  stdout?: ReadableLike | null;
  stderr?: ReadableLike | null;
  kill: (signal?: NodeJS.Signals | number) => unknown;
  once: ((event: "error", listener: (error: Error) => void) => unknown) &
    ((
      event: "close",
      listener: (status: number | null, signal: NodeJS.Signals | null) => void,
    ) => unknown);
}

export interface ProcessRunnerDependencies {
  addSignalHandler?: (signal: NodeJS.Signals, handler: () => void) => unknown;
  killProcess?: (pid: number, signal: NodeJS.Signals) => unknown;
  removeSignalHandler?: (signal: NodeJS.Signals, handler: () => void) => unknown;
  spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ProcessChild;
}

export interface ProcessSignalContext {
  readonly activeChildren: Map<ProcessChild, boolean>;
  signal?: "SIGINT" | "SIGTERM";
}

/** Linux boot and process-start identity read from procfs. */
export interface RunProcessOptions extends Omit<SpawnOptions, "stdio"> {
  captureOutput?: boolean;
  forwardSignals?: boolean;
  killGraceMs?: number;
  killSignal?: NodeJS.Signals;
  maxOutputBytes?: number;
  signalContext?: ProcessSignalContext;
  timeoutMs?: number;
}

export interface ProcessResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  forwardedSignal?: "SIGINT" | "SIGTERM";
  error?: unknown;
}

interface OutputCapture {
  chunks: Buffer[];
  length: number;
  truncated: boolean;
}

interface RunningState {
  completeGroupCleanupIfGone?: () => void;
  error?: unknown;
  groupCleanup?: Promise<void>;
  killTimer?: ReturnType<typeof setTimeout>;
  stderr: OutputCapture;
  stdout: OutputCapture;
  timedOut: boolean;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {},
  dependencies: ProcessRunnerDependencies = {},
): Promise<ProcessResult> {
  if (options.signalContext !== undefined || options.forwardSignals === false) {
    return executeProcess(command, args, options, dependencies);
  }
  const forwarded = await withProcessSignalForwarding(
    async (signalContext) =>
      executeProcess(command, args, { ...options, signalContext }, dependencies),
    dependencies,
    options.killGraceMs,
  );
  return forwarded.signal === undefined
    ? forwarded.value
    : { ...forwarded.value, forwardedSignal: forwarded.signal };
}

export async function withProcessSignalForwarding<T>(
  run: (context: ProcessSignalContext) => Promise<T>,
  dependencies: ProcessRunnerDependencies = {},
  killGraceMs = DEFAULT_KILL_GRACE_MS,
): Promise<{ value: T; signal?: "SIGINT" | "SIGTERM" }> {
  const context: ProcessSignalContext = { activeChildren: new Map() };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const handlers = FORWARDED_SIGNALS.map((signal) => {
    const handler = (): void => {
      if (context.signal !== undefined) {
        return;
      }
      context.signal = signal;
      for (const [child, detached] of context.activeChildren) {
        signalProcess(child, signal, detached, dependencies);
      }
      killTimer = setTimeout(() => {
        for (const [child, detached] of context.activeChildren) {
          signalProcess(child, "SIGKILL", detached, dependencies);
        }
      }, timerDelayMs(killGraceMs));
      killTimer.unref();
    };
    addSignalHandler(signal, handler, dependencies);
    return [signal, handler] as const;
  });
  try {
    const value = await run(context);
    return context.signal === undefined ? { value } : { value, signal: context.signal };
  } finally {
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
    }
    for (const [signal, handler] of handlers) {
      removeSignalHandler(signal, handler, dependencies);
    }
  }
}

async function executeProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions,
  dependencies: ProcessRunnerDependencies,
): Promise<ProcessResult> {
  const {
    captureOutput = true,
    killGraceMs,
    killSignal = "SIGTERM",
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    signalContext,
    timeoutMs,
    ...spawnOptions
  } = options;
  let child: ProcessChild;
  try {
    child = spawnProcess(
      command,
      args,
      {
        ...spawnOptions,
        stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
      },
      dependencies,
    );
  } catch (error) {
    return emptyResult(error);
  }
  const state: RunningState = {
    stderr: emptyCapture(),
    stdout: emptyCapture(),
    timedOut: false,
  };
  signalContext?.activeChildren.set(child, spawnOptions.detached === true);
  if (captureOutput) {
    if (
      child.stdout === null ||
      child.stdout === undefined ||
      child.stderr === null ||
      child.stderr === undefined
    ) {
      signalContext?.activeChildren.delete(child);
      throw new Error("Expected spawned process stdout and stderr pipes");
    }
    child.stdout.on("data", captureListener(state.stdout, maxOutputBytes));
    child.stderr.on("data", captureListener(state.stderr, maxOutputBytes));
  }
  const settled = settleProcess(child, state, signalContext);
  if (signalContext?.signal !== undefined) {
    signalProcess(
      child,
      signalContext.signal,
      spawnOptions.detached === true,
      dependencies,
    );
  }
  armTimeout(
    child,
    state,
    {
      timeoutMs,
      killSignal,
      killGraceMs,
      detached: spawnOptions.detached === true,
    },
    dependencies,
  );
  return settled;
}

async function settleProcess(
  child: ProcessChild,
  state: RunningState,
  signalContext: ProcessSignalContext | undefined,
): Promise<ProcessResult> {
  const running = state;
  child.once("error", (error) => {
    running.error = error;
  });
  return new Promise((resolve) => {
    child.once("close", (status, signal) => {
      const finish = (): void => {
        clearRunningTimers(running);
        signalContext?.activeChildren.delete(child);
        resolve({
          status,
          signal,
          stdout: outputText(running.stdout),
          stderr: outputText(running.stderr),
          stdoutTruncated: running.stdout.truncated,
          stderrTruncated: running.stderr.truncated,
          timedOut: running.timedOut,
          ...(signalContext?.signal === undefined
            ? {}
            : { forwardedSignal: signalContext.signal }),
          ...(running.error === undefined ? {} : { error: running.error }),
        });
      };
      if (running.groupCleanup === undefined) {
        finish();
      } else {
        running.completeGroupCleanupIfGone?.();
        void running.groupCleanup.then(finish);
      }
    });
  });
}

interface TimeoutOptions {
  detached: boolean;
  killGraceMs?: number;
  killSignal: NodeJS.Signals;
  timeoutMs?: number;
}

function armTimeout(
  child: ProcessChild,
  state: RunningState,
  options: TimeoutOptions,
  dependencies: ProcessRunnerDependencies,
): void {
  if (options.timeoutMs === undefined) {
    return;
  }
  const running = state;
  running.timeoutTimer = setTimeout(() => {
    running.timedOut = true;
    running.error = Object.assign(new Error("spawn ETIMEDOUT"), { code: "ETIMEDOUT" });
    const groupSignaled = signalProcess(
      child,
      options.killSignal,
      options.detached,
      dependencies,
    );
    const groupCleanup = Promise.withResolvers<undefined>();
    if (groupSignaled) {
      running.groupCleanup = groupCleanup.promise;
      const groupPid = child.pid;
      if (dependencies.killProcess === undefined && groupPid !== undefined) {
        running.completeGroupCleanupIfGone = (): void => {
          if (processGroupExists(groupPid)) {
            return;
          }
          clearTimeout(running.killTimer);
          running.killTimer = undefined;
          groupCleanup.resolve(undefined);
        };
      }
    }
    running.killTimer = setTimeout(
      () => {
        const groupKilled = signalProcess(
          child,
          "SIGKILL",
          options.detached,
          dependencies,
        );
        if (
          groupKilled &&
          dependencies.killProcess === undefined &&
          child.pid !== undefined
        ) {
          void waitForProcessGroupExit(child.pid).then(groupCleanup.resolve);
        } else {
          groupCleanup.resolve(undefined);
        }
      },
      timerDelayMs(options.killGraceMs ?? DEFAULT_KILL_GRACE_MS),
    );
  }, timerDelayMs(options.timeoutMs));
}

function signalProcess(
  child: ProcessChild,
  signal: NodeJS.Signals,
  detached: boolean,
  dependencies: ProcessRunnerDependencies,
): boolean {
  if (detached && child.pid !== undefined) {
    try {
      (dependencies.killProcess ?? process.kill)(-child.pid, signal);
      return true;
    } catch {
      // Fakes and restricted hosts may not support process-group signaling.
    }
  }
  child.kill(signal);
  return false;
}

async function waitForProcessGroupExit(pid: number): Promise<undefined> {
  const deadline = Date.now() + PROCESS_GROUP_EXIT_WAIT_MS;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, PROCESS_GROUP_EXIT_POLL_MS);
    });
  }
  return undefined;
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function captureListener(
  capture: OutputCapture,
  maxBytes: number,
): (chunk: Buffer) => void {
  const output = capture;
  return (chunk) => {
    const remaining = Math.max(0, maxBytes - output.length);
    if (remaining === 0) {
      output.truncated ||= chunk.length > 0;
      return;
    }
    const kept = chunk.subarray(0, remaining);
    output.chunks.push(kept);
    output.length += kept.length;
    output.truncated ||= kept.length !== chunk.length;
  };
}

function emptyCapture(): OutputCapture {
  return { chunks: [], length: 0, truncated: false };
}

function outputText(capture: OutputCapture): string {
  const text = Buffer.concat(capture.chunks, capture.length).toString("utf8");
  return capture.truncated ? `${text}\n<truncated output>` : text;
}

function emptyResult(error: unknown): ProcessResult {
  return {
    status: null,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
    error,
  };
}

function clearRunningTimers(state: RunningState): void {
  if (state.timeoutTimer !== undefined) {
    clearTimeout(state.timeoutTimer);
  }
  if (state.killTimer !== undefined) {
    clearTimeout(state.killTimer);
  }
}

function spawnProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
  dependencies: ProcessRunnerDependencies,
): ProcessChild {
  return (
    dependencies.spawn?.(command, args, options) ?? spawn(command, [...args], options)
  );
}

function addSignalHandler(
  signal: NodeJS.Signals,
  handler: () => void,
  dependencies: ProcessRunnerDependencies,
): void {
  (dependencies.addSignalHandler ?? process.on.bind(process))(signal, handler);
}

function removeSignalHandler(
  signal: NodeJS.Signals,
  handler: () => void,
  dependencies: ProcessRunnerDependencies,
): void {
  (dependencies.removeSignalHandler ?? process.off.bind(process))(signal, handler);
}

export function signalExitCode(signal: "SIGINT" | "SIGTERM"): 130 | 143 {
  return signal === "SIGINT" ? 130 : 143;
}

export function timerDelayMs(delayMs: number): number {
  return Math.max(0, Math.min(delayMs, MAX_TIMER_DELAY_MS));
}

export function minimalProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    ["PATH", "HOME", "LANG", "LC_ALL", "TERM"].flatMap((key) => {
      const value = env[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
}
