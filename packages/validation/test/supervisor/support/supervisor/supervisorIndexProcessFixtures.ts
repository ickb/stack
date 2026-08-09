import {
  ChildProcess,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from "node:child_process";
import type { PathLike } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { Readable } from "node:stream";
import { isTestRecord, pathToString } from "./supervisorIndexAssertions.ts";
import {
  ESCAPED_REALPATH,
  type SupervisorLstat,
  type SupervisorMkdir,
  type SupervisorRealpath,
  type SupervisorSpawn,
  type SupervisorSpawnSync,
} from "./supervisorIndexConstants.ts";

export function ignoredChecker(ignored: boolean): SupervisorSpawnSync {
  return spawnSyncFixture(() => (ignored ? 0 : 1));
}
export function selectiveIgnoredChecker(ignoredPaths: Set<string>): SupervisorSpawnSync {
  return spawnSyncFixture((args) => (ignoredPaths.has(args.at(-1) ?? "") ? 0 : 1));
}
export function spawnFixture(handler: TestSpawnHandler): SupervisorSpawn {
  return new Proxy(spawn, {
    apply(_target, _thisArg, argArray: unknown[]): ChildProcess {
      const command = stringValue(argArray[0]);
      const commandArgs = optionalStringArray(argArray[1]);
      const options = spawnOptions(argArray[2]);
      return handler(command, commandArgs, options);
    },
  });
}
export function lstatFixture(
  statForPath: (path: PathLike) => Awaited<ReturnType<SupervisorLstat>>,
): SupervisorLstat {
  return new Proxy(lstat, {
    async apply(
      _target,
      _thisArg,
      argArray: unknown[],
    ): Promise<Awaited<ReturnType<SupervisorLstat>>> {
      await Promise.resolve();
      return statForPath(pathLikeValue(argArray[0]));
    },
  });
}
export function realpathFixture(
  pathForPath: (path: PathLike) => string,
): SupervisorRealpath {
  return new Proxy(realpath, {
    async apply(_target, _thisArg, argArray: unknown[]): Promise<string> {
      await Promise.resolve();
      return pathForPath(pathLikeValue(argArray[0]));
    },
  });
}
export function mkdirFixture(
  onMkdir: (path: PathLike, options: unknown) => void,
): SupervisorMkdir {
  return new Proxy(mkdir, {
    async apply(_target, _thisArg, argArray: unknown[]): Promise<void> {
      onMkdir(pathLikeValue(argArray[0]), argArray[1]);
      await Promise.resolve();
      return undefined;
    },
  });
}
export function fakeSuccessfulPreflightChild(): ReturnType<typeof fakeChild> {
  return fakeChild(JSON.stringify({ chain: "testnet", bounded: true, maxIterations: 1 }));
}
export function fakePreflightChild({
  ckbAvailable,
  ckbPlainAvailable = ckbAvailable,
  ckbProjectedAvailable = ckbAvailable,
  ckbSpendable,
  ickbAvailable,
  ickbUnavailable,
  ickbTotal,
}: {
  ckbAvailable: string;
  ckbPlainAvailable?: string;
  ckbProjectedAvailable?: string;
  ckbSpendable?: string;
  ickbAvailable: string;
  ickbUnavailable?: string;
  ickbTotal?: string;
}): ReturnType<typeof fakeChild> {
  return fakeChild(
    JSON.stringify({
      chain: "testnet",
      bounded: true,
      maxIterations: 1,
      balances: {
        CKB: {
          available: ckbAvailable,
          plainAvailable: ckbPlainAvailable,
          projectedAvailable: ckbProjectedAvailable,
          ...(ckbSpendable === undefined ? {} : { spendable: ckbSpendable }),
        },
        ICKB: {
          available: ickbAvailable,
          ...(ickbUnavailable === undefined ? {} : { unavailable: ickbUnavailable }),
          ...(ickbTotal === undefined ? {} : { total: ickbTotal }),
        },
      },
    }),
  );
}
export function fakeChild(stdout: string, status = 0, stderr = ""): FakeChild {
  const child = new FakeChild();
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(`${stdout}\n`));
    if (stderr !== "") {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.emit("close", status, null);
  });
  return child;
}
export function fakeHangingChild(): FakeChild {
  const child = new FakeChild(1234);
  child.kill = (signal = "SIGTERM"): boolean => {
    if (signal === "SIGKILL") {
      queueMicrotask(() => {
        child.emit("close", null, "SIGKILL");
      });
    }
    return true;
  };
  return child;
}
export function missingStat(): never {
  throw errno("missing", "ENOENT");
}
export function eexist(message = "exists"): NodeJS.ErrnoException {
  return errno(message, "EEXIST");
}
export function realpathEscapesText(path: PathLike): string {
  return pathToString(path) === "/repo" ? "/repo" : ESCAPED_REALPATH;
}
export function recursiveOption(value: unknown): boolean | undefined {
  if (isTestRecord(value) && typeof value["recursive"] === "boolean") {
    return value["recursive"];
  }
  return undefined;
}
export async function noopAsync(): Promise<undefined> {
  await Promise.resolve();
  return undefined;
}
export function spawnSyncFixture(
  statusForArgs: (args: string[], command: string, options?: TestSpawnOptions) => number,
): SupervisorSpawnSync {
  return new Proxy(spawnSync, {
    apply(_target, _thisArg, argArray: unknown[]): SpawnSyncReturns<Buffer> {
      return spawnSyncResult(
        statusForArgs(
          optionalStringArray(argArray[1]),
          stringValue(argArray[0]),
          spawnOptions(argArray[2]),
        ),
      );
    },
  });
}
function pathLikeValue(value: unknown): PathLike {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value instanceof URL) {
    return value.toString();
  }
  return "";
}
function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return "";
}
function optionalStringArray(value: unknown): string[] {
  if (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return value;
  }
  return [];
}
function spawnOptions(value: unknown): TestSpawnOptions {
  if (isTestRecord(value) && isProcessEnv(value["env"])) {
    return { env: value["env"] };
  }
  return {};
}
function isProcessEnv(value: unknown): value is NodeJS.ProcessEnv {
  if (!isTestRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) => item === undefined || typeof item === "string",
  );
}
function spawnSyncResult(status: number): SpawnSyncReturns<Buffer> {
  return {
    pid: 0,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status,
    signal: null,
  };
}
export function stringifyJsonLine(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}
export function isPreflightCommand(args: readonly string[]): boolean {
  return args[0] === "scripts/live/preflight.ts";
}
export class FakeChild extends ChildProcess {
  public override readonly pid: number | undefined;
  public override stdout = new Readable({ read: noopRead });
  public override stderr = new Readable({ read: noopRead });

  constructor(pid?: number) {
    super();
    this.pid = pid;
  }

  public override kill(): boolean {
    return true;
  }
}
function noopRead(): void {
  noopVoid();
}
export function noopVoid(): void {
  // Intentionally empty fixture hook.
}
function errno(message: string, code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}
export interface TestSpawnOptions {
  env?: NodeJS.ProcessEnv;
}
export type TestSpawnHandler = (
  command: string,
  args: string[],
  options: TestSpawnOptions,
) => ChildProcess;
