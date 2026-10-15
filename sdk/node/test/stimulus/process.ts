import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../../src/stimulus.ts");
const privateKey = `0x${"42".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:1/rpc?token=canary";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ickb-stimulus-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("stimulus process", () => {
  it("rejects arguments and fails fast without config", () => {
    const withArgument = run({}, ["--unknown"]);
    expect(withArgument.status).toBe(1);
    expect(withArgument.stderr).toContain("Unknown argument: --unknown");

    const withoutConfig = run({});
    expect(withoutConfig.status).toBe(1);
    expect(withoutConfig.stdout).toBe("");
    expect(withoutConfig.stderr).toContain("Empty env STIMULUS_CHAIN");
  });

  it("logs one failure line when the RPC is unreachable", async () => {
    const keyPath = path.join(dir, "testnet.key");
    await writeFile(keyPath, privateKey, { mode: 0o600 });

    const result = run({
      STIMULUS_CHAIN: "testnet",
      STIMULUS_RPC_URL: rpcUrl,
      STIMULUS_PRIVATE_KEY_FILE: keyPath,
      STIMULUS_KIND: "order",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      outcome: "failed",
      error: { message: "fetch failed" },
    });
    expect(result.stdout).not.toContain(privateKey);
    expect(result.stdout).not.toContain("token=canary");
  }, 30_000);
});

function run(env: Record<string, string>, args: string[] = []): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
    timeout: 25_000,
  });
}
