import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../src/index.ts");
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
  it("fails fast without a config file", () => {
    const result = runBot({});

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Empty env BOT_CONFIG_FILE");
  });

  it("emits run start then a retryable turn failure when the RPC is unreachable", async () => {
    const configPath = path.join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ chain: "testnet", privateKey, rpcUrl }),
      {
        mode: 0o600,
      },
    );

    const result = runBot({ BOT_CONFIG_FILE: configPath });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const events = result.stdout.trim().split("\n").map(parseEvent);
    expect(events.map((event) => String(event["type"]))).toEqual([
      "bot.run.started",
      "bot.turn.failed",
    ]);
    expect(events[1]).toMatchObject({
      chain: "testnet",
      retryable: true,
      terminal: false,
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
