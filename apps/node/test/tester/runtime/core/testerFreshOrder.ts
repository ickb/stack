import { ccc } from "@ckb-ccc/core";
import { OrderManager } from "@ickb/sdk";

import { byte32FromByte, headerLike } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  freshMatchableOrderSkip,
  MissingFreshOrderOriginError,
} from "../../../../src/tester/runtime/freshMatchableOrderSkip.ts";
import {
  FRESH_MATCHABLE_ORDER_REASON,
  FRESH_MATCHABLE_ORDER_SKIP,
  freshOrderRuntime,
  matchableOrder,
  matchedDescendantOrder,
  nonMatchableOrder,
  udtToCkbOrder,
  unmarketableOrder,
} from "../../support/tester/index.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(FRESH_MATCHABLE_ORDER_SKIP, () => {
  it("fails closed when origin transaction lookup is unavailable", async () => {
    const txHash = byte32FromByte("11");
    const { runtime } = freshOrderRuntime();

    let thrown: unknown;
    try {
      await freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash)],
        headerLike({ number: 200000n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MissingFreshOrderOriginError);
    if (!(thrown instanceof Error)) {
      throw new Error("Expected Error");
    }
    expect(thrown.message).toContain(
      "Missing origin transaction block number for fresh-order guard",
    );
  });

  it("explains skips caused by fresh matchable orders", async () => {
    const txHash = byte32FromByte("22");
    const { runtime } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toEqual({
      reason: FRESH_MATCHABLE_ORDER_REASON,
      txHash,
      blockNumber: 100000n,
      tipNumber: 100180n,
      maxElapsedBlocks: 180n,
    });
  });

  it("does not skip stale or non-matchable orders", async () => {
    const staleTxHash = byte32FromByte("33");
    const nonMatchableTxHash = byte32FromByte("44");
    const { runtime } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(staleTxHash), await nonMatchableOrder(nonMatchableTxHash)],
        headerLike({ number: 100181n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toBeUndefined();
  });
});

describe(`${FRESH_MATCHABLE_ORDER_SKIP} incomplete search`, () => {
  it("fails closed when singleton exact search reports incomplete", async () => {
    const txHash = byte32FromByte("23");
    const { runtime } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
    });
    const group = await matchableOrder(txHash);
    const diagnostics = OrderManager.bestMatch(
      [group],
      { ckbValue: 1n, udtValue: 1n },
      { ckbScale: 1n, udtScale: 1n },
      { feeRate: 0n, maxPartials: 1 },
    ).match.diagnostics;
    if (diagnostics === undefined) {
      throw new Error("Expected match diagnostics");
    }
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      kind: "incomplete",
      match: { ckbDelta: 0n, udtDelta: 0n, partials: [], diagnostics },
      reason: "candidate_budget_exhausted",
      searchMode: "stepped",
      budget: 1,
      work: 1,
      truncation: { phase: "candidates", requiredWork: 2n },
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [group],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toMatchObject({ reason: FRESH_MATCHABLE_ORDER_REASON, txHash });
  });

  it("propagates unexpected singleton search failures", async () => {
    const txHash = byte32FromByte("24");
    const { runtime } = freshOrderRuntime();
    vi.spyOn(OrderManager, "bestMatch").mockImplementation(() => {
      throw new Error("unexpected search failure");
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).rejects.toThrow("unexpected search failure");
  });
});
describe(`${FRESH_MATCHABLE_ORDER_SKIP} opposite-direction orders`, () => {
  it.each([
    ["CKB-to-iCKB", "34", matchableOrder],
    ["iCKB-to-CKB", "35", udtToCkbOrder],
  ] as const)(
    "blocks new tester stimulus on fresh opposite-direction %s orders",
    async (_direction, txHashByte, order) => {
      const txHash = byte32FromByte(txHashByte);
      const { runtime, getTransactionResponse, getTransaction } = freshOrderRuntime({
        rpcBlockNumber: 100000n,
        tracked: true,
      });

      await expect(
        freshMatchableOrderSkip(
          runtime,
          [await order(txHash)],
          headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
          { feeRate: 0n },
        ),
      ).resolves.toEqual({
        reason: FRESH_MATCHABLE_ORDER_REASON,
        txHash,
        blockNumber: 100000n,
        tipNumber: 100180n,
        maxElapsedBlocks: 180n,
      });
      expect(getTransactionResponse).toHaveBeenCalledWith(txHash);
      expect(getTransaction).toHaveBeenCalledWith(txHash);
    },
  );
});
describe(`${FRESH_MATCHABLE_ORDER_SKIP} marketability`, () => {
  it("does not skip fresh owned orders that are not marketable at the midpoint", async () => {
    const txHash = byte32FromByte("45");
    const { runtime } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await unmarketableOrder(txHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toBeUndefined();
  });

  it("does not skip fresh owned orders whose gain is below the live fee", async () => {
    const txHash = byte32FromByte("46");
    const { runtime, getTransactionResponse, getTransaction } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
      tracked: true,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: ccc.fixedPointFrom(1000) },
      ),
    ).resolves.toBeUndefined();
    expect(getTransactionResponse).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
  });
});
describe(`${FRESH_MATCHABLE_ORDER_SKIP} origin lookup`, () => {
  it("does not let fresh bot-updated descendants block new tester stimulus", async () => {
    const descendantTxHash = byte32FromByte("47");
    const mintTxHash = byte32FromByte("48");
    const { runtime, getTransactionResponse, getTransaction } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
      tracked: true,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchedDescendantOrder(descendantTxHash, mintTxHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toBeUndefined();
    expect(getTransactionResponse).not.toHaveBeenCalled();
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("uses cached origin transaction responses before making another RPC read", async () => {
    const txHash = byte32FromByte("49");
    const { runtime, getTransactionResponse, getTransaction } = freshOrderRuntime({
      cachedBlockNumber: 100000n,
      tracked: true,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash)],
        headerLike({ number: 100180n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toEqual({
      reason: FRESH_MATCHABLE_ORDER_REASON,
      txHash,
      blockNumber: 100000n,
      tipNumber: 100180n,
      maxElapsedBlocks: 180n,
    });
    expect(getTransactionResponse).toHaveBeenCalledWith(txHash);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("reuses one origin lookup for repeated same-transaction orders", async () => {
    const txHash = byte32FromByte("4a");
    const { runtime, getTransactionResponse, getTransaction } = freshOrderRuntime({
      rpcBlockNumber: 100000n,
      tracked: true,
    });

    await expect(
      freshMatchableOrderSkip(
        runtime,
        [await matchableOrder(txHash), await matchableOrder(txHash)],
        headerLike({ number: 100181n, epoch: ccc.Epoch.from([0n, 0n, 1n]) }),
        { feeRate: 0n },
      ),
    ).resolves.toBeUndefined();
    expect(getTransactionResponse).toHaveBeenCalledTimes(1);
    expect(getTransaction).toHaveBeenCalledTimes(1);
  });
});
