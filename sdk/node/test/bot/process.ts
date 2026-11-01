import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../../src/bot.ts");
const privateKey = `0x${"42".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:1/rpc?token=canary";
const TESTNET_GENESIS =
  "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
let dir = "";
let keyPath = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ickb-bot-cli-"));
  keyPath = path.join(dir, "testnet.key");
  await writeFile(keyPath, privateKey, { mode: 0o600 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bot process", () => {
  it("fails fast without config", async () => {
    const result = await runBot({});

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Empty env BOT_CHAIN");
  });

  it("refuses an invalid fee cap before any event", async () => {
    const result = await runBot({
      BOT_CHAIN: "testnet",
      BOT_RPC_URL: rpcUrl,
      BOT_PRIVATE_KEY_FILE: keyPath,
      BOT_MAX_FEE_RATE: "999",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Invalid env BOT_MAX_FEE_RATE");
  }, 30_000);

  it("emits turn start then the turn failure when the RPC is unreachable", async () => {
    const result = await runBot({
      BOT_CHAIN: "testnet",
      BOT_RPC_URL: rpcUrl,
      BOT_PRIVATE_KEY_FILE: keyPath,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const events = parseEvents(result.stdout);
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

  it("emits its identity only after the node's genesis matches the chain", async () => {
    const run = async (genesis: string): Promise<Array<Record<string, unknown>>> => {
      const server = await genesisNode(genesis);
      try {
        const address = server.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        const result = await runBot({
          BOT_CHAIN: "testnet",
          BOT_RPC_URL: `http://127.0.0.1:${String(port)}/`,
          BOT_PRIVATE_KEY_FILE: keyPath,
        });
        expect(result.status).toBe(1);
        expect(result.stdout).not.toContain(privateKey);
        return parseEvents(result.stdout);
      } finally {
        server.close();
      }
    };

    const matching = await run(TESTNET_GENESIS);
    expect(matching.map((event) => String(event["type"]))).toEqual([
      "bot.turn.started",
      "bot.chain.preflight",
      "bot.turn.failed",
    ]);
    expect(matching[1]).toMatchObject({
      identity: { rpcEndpoints: [{ protocol: "http:", hostname: "127.0.0.1" }] },
    });
    const other = await run(`0x${"11".repeat(32)}`);
    expect(other.map((event) => String(event["type"]))).toEqual([
      "bot.turn.started",
      "bot.turn.failed",
    ]);
    expect(JSON.stringify(other[1])).toContain("Invalid testnet RPC chain identity");
  }, 60_000);
});

/**
 * A node that knows only a genesis header with the given hash and an empty cell index, and
 * fails every other request, so the bot's first turn fails right after its preflight.
 */
async function genesisNode(genesis: string): Promise<Server> {
  const zero = `0x${"00".repeat(32)}`;
  const results: Record<string, unknown> = {
    get_header_by_number: {
      compact_target: "0x0",
      dao: zero,
      epoch: "0x0",
      extra_hash: zero,
      hash: genesis,
      nonce: "0x0",
      number: "0x0",
      parent_hash: zero,
      proposals_hash: zero,
      timestamp: "0x0",
      transactions_root: zero,
      version: "0x0",
    },
    get_cells: { objects: [], last_cursor: "0x" },
  };
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      // Only the bot posts JSON-RPC; a port probe from elsewhere on the host gets nothing.
      if (request.method !== "POST") {
        response.end();
        return;
      }
      const { id, method } = parseEvent(body);
      const answer = Object.hasOwn(results, String(method))
        ? { result: results[String(method)] }
        : { error: { code: -32_601, message: "unsupported" } };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id, ...answer }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

/** Runs the bot asynchronously, so a node served by this test process can answer it. */
async function runBot(
  env: Record<string, string>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [entrypoint], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    timeout: 25_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  return { status, stdout, stderr };
}

function parseEvents(stdout: string): Array<Record<string, unknown>> {
  return stdout.trim().split("\n").map(parseEvent);
}

function parseEvent(line: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(line);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`Expected an event object: ${line}`);
  }
  return Object.fromEntries(Object.entries(parsed));
}
