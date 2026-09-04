import {
  ChildProcess,
  type SpawnSyncReturns,
  spawn,
  spawnSync,
} from "node:child_process";
import { Readable } from "node:stream";
import { isTestRecord } from "./supervisorIndexAssertions.ts";
import type { SupervisorSpawn, SupervisorSpawnSync } from "./supervisorIndexConstants.ts";

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
export interface TestSpawnOptions {
  env?: NodeJS.ProcessEnv;
}
export type TestSpawnHandler = (
  command: string,
  args: string[],
  options: TestSpawnOptions,
) => ChildProcess;
