import { describe, expect, it } from "vitest";
import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { freshMatchableOrderSkip } from "./freshMatchableOrderSkip.js";

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
