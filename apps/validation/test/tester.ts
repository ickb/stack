import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../src/tester.ts");
const privateKey = `0x${"42".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:1/rpc?token=canary";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ickb-tester-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("tester process", () => {
  it("rejects arguments and fails fast without config", () => {
    const withArgument = runTester({}, ["--unknown"]);
    expect(withArgument.status).toBe(1);
    expect(withArgument.stderr).toContain("Unknown argument: --unknown");

    const withoutConfig = runTester({});
    expect(withoutConfig.status).toBe(1);
    expect(withoutConfig.stdout).toBe("");
    expect(withoutConfig.stderr).toContain("Empty env TESTER_CHAIN");
  });

  it("logs one retryable failure line when the RPC is unreachable", async () => {
    const keyPath = path.join(dir, "testnet.key");
    await writeFile(keyPath, privateKey, { mode: 0o600 });

    const result = runTester({
      TESTER_CHAIN: "testnet",
      TESTER_RPC_URL: rpcUrl,
      TESTER_PRIVATE_KEY_FILE: keyPath,
      TESTER_SCENARIO: "auto",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      error: { message: "Retryable tester error", retryable: true },
    });
    expect(result.stdout).not.toContain(privateKey);
    expect(result.stdout).not.toContain("token=canary");
  }, 30_000);
});

function runTester(
  env: Record<string, string>,
  args: string[] = [],
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
    timeout: 25_000,
  });
}
