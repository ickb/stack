import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../../src/bot.ts");
const privateKey = `0x${"42".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:1/rpc?token=canary";
let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bot process", () => {
  it("fails fast without config", () => {
    const result = runBot({});

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Empty env BOT_CHAIN");
  });

  it("emits turn start then the turn failure when the RPC is unreachable", async () => {
    const keyPath = path.join(dir, "testnet.key");
    await writeFile(keyPath, privateKey, { mode: 0o600 });

    const result = runBot({
      BOT_CHAIN: "testnet",
      BOT_RPC_URL: rpcUrl,
      BOT_PRIVATE_KEY_FILE: keyPath,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const events = result.stdout.trim().split("\n").map(parseEvent);
    expect(events.map((event) => String(event["type"]))).toEqual([
      "bot.turn.started",
      "bot.turn.failed",
    ]);
    expect(events[1]).toMatchObject({
      chain: "testnet",
      error: { message: "fetch failed" },
    });
    expect(events[0]?.["runId"]).toBe(events[1]?.["runId"]);
    expect(result.stdout).not.toContain(privateKey);
    expect(result.stdout).not.toContain("token=canary");
  }, 30_000);
});

function runBot(env: Record<string, string>): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entrypoint], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
    timeout: 25_000,
  });
}

function parseEvent(line: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Expected an event object: ${line}`);
  }
  return Object.fromEntries(Object.entries(parsed));
}
