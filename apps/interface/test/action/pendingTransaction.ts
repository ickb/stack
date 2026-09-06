import type { ccc } from "@ckb-ccc/ccc";
import { describe, expect, it, vi } from "vitest";
import {
  clearPendingTransaction,
  createPendingTransactionStore,
  submitPendingTransaction,
  type PendingTransactionState,
  type PendingTransactionStore,
} from "../../src/action/pendingTransaction.ts";

const txHash = `0x${"ab".repeat(32)}` as const;

/** The record has no owning component in these tests. */
function ignoreChange(): void {
  // Nothing renders the record here.
}
const walletRejected = "wallet rejected";

describe("pending transaction store", () => {
  it("mirrors every write to its owner and starts from the given record", async () => {
    const observed: Array<PendingTransactionState | undefined> = [];
    const store = createPendingTransactionStore(
      (state) => {
        observed.push(state);
      },
      { status: "pending", txHash },
    );

    expect(store.current).toEqual({ status: "pending", txHash });
    clearPendingTransaction(store);
    await recordPending(store, txHash);

    expect(observed.map((state) => state?.status)).toEqual([
      undefined,
      "submitting",
      "pending",
    ]);
    expect(store.current).toEqual({ status: "pending", txHash });
  });
});

describe("pending transaction submission ownership", () => {
  it("publishes one submission and reuses it across synchronous callers", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const sent = Promise.withResolvers<typeof txHash>();
    const firstSend = vi.fn(async () => {
      await sent.promise;
      return txHash;
    });
    const secondSend = vi.fn(async () => {
      await Promise.resolve();
      return txHash;
    });

    const first = submitPendingTransaction(store, firstSend);
    const second = submitPendingTransaction(store, secondSend);
    expect(store.current?.status).toBe("submitting");
    await vi.waitFor(() => {
      expect(firstSend).toHaveBeenCalledTimes(1);
    });

    expect(secondSend).not.toHaveBeenCalled();
    sent.resolve(txHash);
    await expect(Promise.all([first, second])).resolves.toEqual([txHash, txHash]);
    expect(pendingHash(store)).toBe(txHash);
    await expect(submitPendingTransaction(store, secondSend)).resolves.toBe(txHash);
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("clears a rejected current submission owner", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const rejected = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(store, async () => {
      await rejected.promise;
      return txHash;
    });

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(store.current).toBeUndefined();
  });
});

describe("pending transaction late settlement", () => {
  it("does not let a late rejection clear a newer owner", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const rejected = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(store, async () => {
      await rejected.promise;
      return txHash;
    });
    await Promise.resolve();
    const newerHash = `0x${"cd".repeat(32)}` as const;
    // Only a clear frees the session for the newer submission that must survive.
    clearPendingTransaction(store);
    await recordPending(store, newerHash);

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(pendingHash(store)).toBe(newerHash);
  });

  it("does not let a late hash replace a newer pending transaction", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const sent = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(store, async () => sent.promise);
    await Promise.resolve();
    const newerHash = `0x${"cd".repeat(32)}` as const;
    clearPendingTransaction(store);
    await recordPending(store, newerHash);

    sent.resolve(txHash);

    await expect(attempt).resolves.toBe(txHash);
    expect(pendingHash(store)).toBe(newerHash);
  });

  it("does not restore a submission that was explicitly cleared", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const sent = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(store, async () => sent.promise);
    await Promise.resolve();
    clearPendingTransaction(store);

    sent.resolve(txHash);

    await expect(attempt).resolves.toBe(txHash);
    expect(store.current).toBeUndefined();
  });
});

/** Establishes pending state exactly as a completed submission does. */
async function recordPending(
  store: PendingTransactionStore,
  hash: ccc.Hex,
): Promise<void> {
  await submitPendingTransaction(store, async (recordTxHash) => {
    recordTxHash(hash);
    await Promise.resolve();
    return hash;
  });
}

function pendingHash(store: PendingTransactionStore): ccc.Hex | undefined {
  return store.current?.status === "pending" ? store.current.txHash : undefined;
}
