import { main, TESTER_OWNED_TX_HASH_FLAG } from "@ickb/validation";
import { ChildProcess, spawn, spawnSync, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testerEntrypoint = fileURLToPath(
  new URL("fixtures/twoPassTesterProcess.ts", import.meta.url),
);
const pressureEntrypoint = fileURLToPath(
  new URL("fixtures/testerStdoutPressureProcess.ts", import.meta.url),
);
const expectedTxHash = `0x${"ab".repeat(32)}`;

describe("validation tester process provenance", () => {
  it("transfers one pass-one order hash into the pass-two tester runtime", async () => {
    const actorArgs: string[][] = [];
    const stderr: string[] = [];
    const root = await mkdtemp(path.join(tmpdir(), "ickb-validation-process-"));
    const exitCode = await main(
      [
        "--out-dir",
        path.join(root, "validation", "process", "chunks", "chunk-0001", "run-0001"),
        "--scenario",
        "tester-fresh-skip-two-pass",
        "--target-outcome",
        "tester_order_created",
        "--target-outcome",
        "tester_fresh_order_skip",
        "--max-cycles",
        "1",
      ],
      {
        actorEntrypoints: { bot: "unused", tester: testerEntrypoint },
        spawnCommand: processSpawn(actorArgs),
        spawnSyncCommand: new Proxy(spawnSync, {
          apply(): { status: number } {
            return { status: 0 };
          },
        }),
      },
      {
        stdout: { write: () => true },
        stderr: {
          write: (chunk) => {
            stderr.push(String(chunk));
            return true;
          },
        },
      },
    );

    expect(stderr).toEqual([]);
    expect(exitCode).toBe(0);
    expect(actorArgs).toEqual([
      [testerEntrypoint],
      [testerEntrypoint, TESTER_OWNED_TX_HASH_FLAG, expectedTxHash],
    ]);
  });

  it("drains pressure-sized stdout before exiting with tester status 2", async () => {
    const child = spawn(process.execPath, [pressureEntrypoint], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const close = readCloseStatus(child);
    const [stdout, stderr, status] = await Promise.all([
      readStream(child.stdout),
      readStream(child.stderr),
      close,
    ]);
    const lines = stdout.trimEnd().split("\n");

    expect(stderr).toBe("");
    expect(status).toBe(2);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({ pressure: "x".repeat(1024 * 1024) });
    expect(JSON.parse(lines[1] ?? "null")).toEqual({ final: true, status: 2 });
  });
});

function successfulPreflightChild(): ChildProcess {
  const child = new FixtureChild();
  queueMicrotask(() => {
    child.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({ chain: "testnet", bounded: true, maxIterations: 1 })}\n`,
      ),
    );
    child.emit("close", 0, null);
  });
  return child;
}

function processSpawn(actorArgs: string[][]): typeof spawn {
  return new Proxy(spawn, {
    apply(_target, _thisArg, argArray: unknown[]): ChildProcess {
      const command = typeof argArray[0] === "string" ? argArray[0] : "";
      const args = stringArray(argArray[1]);
      if (args[0] === "scripts/live/preflight.ts") {
        return successfulPreflightChild();
      }
      actorArgs.push(args);
      return spawn(command, args, spawnOptions(argArray[2]));
    },
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function spawnOptions(value: unknown): SpawnOptions {
  if (!isRecord(value)) {
    return {};
  }
  return {
    ...(typeof value["cwd"] === "string" ? { cwd: value["cwd"] } : {}),
    ...(typeof value["detached"] === "boolean" ? { detached: value["detached"] } : {}),
    ...(isProcessEnv(value["env"]) ? { env: value["env"] } : {}),
    stdio: ["ignore", "pipe", "pipe"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProcessEnv(value: unknown): value is NodeJS.ProcessEnv {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => item === undefined || typeof item === "string")
  );
}

class FixtureChild extends ChildProcess {
  public override stdout = new Readable({ read: noopRead });
  public override stderr = new Readable({ read: noopRead });
}

function noopRead(): void {
  // The fixture pushes its complete output before closing.
}

async function readStream(stream: Readable | null): Promise<string> {
  if (stream === null) {
    return "";
  }
  let output = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    output += String(chunk);
  }
  return output;
}

async function readCloseStatus(child: ChildProcess): Promise<number | null> {
  const result: unknown = await once(child, "close");
  if (!Array.isArray(result)) {
    throw new TypeError("invalid child close event");
  }
  const status: unknown = result[0];
  if (status !== null && typeof status !== "number") {
    throw new TypeError("invalid child exit status");
  }
  return status;
}
