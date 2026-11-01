import { byte32FromByte } from "@ickb/testkit";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entrypoint = path.join(import.meta.dirname, "../../src/stimulus.ts");
const privateKey = `0x${"42".repeat(32)}`;
const rpcUrl = "http://127.0.0.1:1/rpc?token=canary";
const TESTNET_GENESIS_HASH =
  "0x10639e0895502b5688a6be8cf69460d76541bfa4821629d86d62ba0aae3f9606";
let dir = "";
let keyPath = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ickb-stimulus-cli-"));
  keyPath = path.join(dir, "testnet.key");
  await writeFile(keyPath, privateKey, { mode: 0o600 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("stimulus process", () => {
  it("fails fast without config", async () => {
    const withoutConfig = await run({});
    expect(withoutConfig.status).toBe(1);
    expect(withoutConfig.stdout).toBe("");
    expect(withoutConfig.stderr).toContain("Empty env STIMULUS_CHAIN");
  });

  it("logs one failure line when the RPC is unreachable", async () => {
    const result = await run({
      ...configured(rpcUrl),
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

  it("refuses a node on another chain, and names its own identity past preflight", async () => {
    const otherChain = await withNode(byte32FromByte("01"));
    const testnet = await withNode(TESTNET_GENESIS_HASH);

    expect(JSON.parse(otherChain.stdout)).toMatchObject({ outcome: "failed" });
    expect(otherChain.stdout).toContain("Invalid testnet RPC chain identity");
    // The turn's first read fails, so its line carries the identity and the node's error.
    expect(JSON.parse(testnet.stdout)).toMatchObject({
      identity: {
        chain: "testnet",
        rpcEndpoints: [{ protocol: "http:", hostname: "127.0.0.1" }],
      },
      outcome: "failed",
    });
    expect(testnet.stdout).toMatch(/"address":"ckt1/u);
    expect(testnet.stdout).toContain("Method not found");
    expect(testnet.stdout).not.toContain(privateKey);
  }, 30_000);
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function configured(url: string): Record<string, string> {
  return {
    STIMULUS_CHAIN: "testnet",
    STIMULUS_RPC_URL: url,
    STIMULUS_PRIVATE_KEY_FILE: keyPath,
  };
}

/** Runs the entrypoint asynchronously, so a node served from this process can answer it. */
async function run(env: Record<string, string>): Promise<Run> {
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
  await once(child, "close");
  return { status: child.exitCode, stdout, stderr };
}

/**
 * Runs the entrypoint against a local node whose genesis hash is `genesisHash`: it serves
 * that header and empty cell pages, and answers every other method as unknown.
 */
async function withNode(genesisHash: string): Promise<Run> {
  const zero = byte32FromByte("00");
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8").on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      let call: unknown;
      try {
        call = JSON.parse(body);
      } catch {
        // Other local processes can reach the port, such as with a bodiless GET.
        call = undefined;
      }
      const method =
        typeof call === "object" && call !== null && "method" in call
          ? call.method
          : undefined;
      const id =
        typeof call === "object" && call !== null && "id" in call ? call.id : null;
      const answers: Record<string, object> = {
        get_header_by_number: {
          result: {
            compact_target: "0x0",
            dao: zero,
            epoch: "0x0",
            extra_hash: zero,
            hash: genesisHash,
            nonce: "0x0",
            number: "0x0",
            parent_hash: zero,
            proposals_hash: zero,
            timestamp: "0x0",
            transactions_root: zero,
            version: "0x0",
          },
        },
        get_cells: { result: { objects: [], last_cursor: "0x" } },
      };
      const answer = (typeof method === "string" ? answers[method] : undefined) ?? {
        error: { code: -32601, message: "Method not found" },
      };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id, ...answer }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    if (address === null || typeof address === "string") {
      throw new TypeError("Expected a local TCP server address");
    }
    return await run(configured(`http://127.0.0.1:${String(address.port)}/`));
  } finally {
    server.close();
  }
}
