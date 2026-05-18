import { describe, expect, it } from "vitest";
import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";
import { readTesterRuntimeConfig } from "./index.js";

describe("readTesterRuntimeConfig", () => {
  it("reads legacy direct env config", async () => {
    const privateKey = `0x${"11".repeat(32)}`;

    await expect(readTesterRuntimeConfig({
      CHAIN: "testnet",
      TESTER_PRIVATE_KEY: privateKey,
      TESTER_SLEEP_INTERVAL: "10",
      RPC_URL: "http://127.0.0.1:8114/",
      MAX_ITERATIONS: "1",
    })).resolves.toEqual({
      chain: "testnet",
      privateKey,
      rpcUrl: "http://127.0.0.1:8114/",
      sleepIntervalMs: 10000,
      maxIterations: 1,
    });
  });

  it("rejects mixed JSON config and legacy env config", async () => {
    await expect(readTesterRuntimeConfig({
      TESTER_CONFIG_FILE: "/run/credentials/tester/config.json",
      TESTER_SLEEP_INTERVAL: "10",
    })).rejects.toThrow("Set only one of TESTER_CONFIG_FILE or TESTER_SLEEP_INTERVAL");
  });

  it("reads JSON config files", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-tester-config-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalSeconds: 10,
        maxIterations: 1,
      }), { mode: 0o600 });

      await expect(readTesterRuntimeConfig({ TESTER_CONFIG_FILE: configPath })).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 10000,
        maxIterations: 1,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("freshMatchableOrderSkip", () => {
  it("explains skips caused by unavailable transaction lookup", async () => {
    const txHash = byte32FromByte("11");
    const runtime = {
      client: {
        getTransaction: (): Promise<undefined> => Promise.resolve(undefined),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(txHash)],
      headerLike({ number: 200000n }),
    )).resolves.toEqual({
      reason: "matchable-order-transaction-missing",
      txHash,
    });
  });

  it("explains skips caused by fresh matchable orders", async () => {
    const txHash = byte32FromByte("22");
    const runtime = {
      client: {
        getTransaction: (): Promise<{ blockNumber: bigint }> => Promise.resolve({ blockNumber: 100000n }),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(txHash)],
      headerLike({ number: 200000n }),
    )).resolves.toEqual({
      reason: "fresh-matchable-order",
      txHash,
      blockNumber: 100000n,
      tipNumber: 200000n,
      maxElapsedBlocks: 100800n,
    });
  });

  it("does not skip stale or non-matchable orders", async () => {
    const runtime = {
      client: {
        getTransaction: (): Promise<{ blockNumber: bigint }> => Promise.resolve({ blockNumber: 100000n }),
      },
    };

    await expect(freshMatchableOrderSkip(
      runtime as never,
      [matchableOrder(byte32FromByte("33")), nonMatchableOrder(byte32FromByte("44"))],
      headerLike({ number: 200801n }),
    )).resolves.toBeUndefined();
  });
});

function matchableOrder(txHash: ccc.Hex): never {
  return order(txHash, true);
}

function nonMatchableOrder(txHash: ccc.Hex): never {
  return order(txHash, false);
}

function order(txHash: ccc.Hex, isMatchable: boolean): never {
  return {
    order: {
      isMatchable: () => isMatchable,
      cell: ccc.Cell.from({
        outPoint: { txHash, index: 0n },
        cellOutput: { capacity: 0n, lock: script("55") },
        outputData: "0x",
      }),
    },
  } as never;
}
