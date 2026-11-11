import type { ccc } from "@ckb-ccc/ccc";
import type { SignAndSendTransactionResult } from "@ickb/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  clearPendingTransaction,
  createPendingTransactionStore,
  submitPendingTransaction,
  type PendingTransactionState,
  type PendingTransactionStore,
} from "../../src/action/pendingTransaction.ts";
import { recordPending } from "./fixtures/transaction.ts";

const txHash = `0x${"ab".repeat(32)}` as const;
const SENT: SignAndSendTransactionResult = { ok: true, txHash };

/** The record has no owning component in these tests. */
function ignoreChange(): void {
  // Nothing renders the record here.
}
const walletRejected = "wallet rejected";

describe("pending transaction store", () => {
  it("mirrors every write to its owner and starts empty", async () => {
    const observed: Array<PendingTransactionState | undefined> = [];
    const store = createPendingTransactionStore((state) => {
      observed.push(state);
    });

    expect(store.current).toBeUndefined();
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
    const sent = Promise.withResolvers<SignAndSendTransactionResult>();
    const firstSend = vi.fn(async () => {
      return sent.promise;
    });
    const secondSend = vi.fn(async () => {
      await Promise.resolve();
      return SENT;
    });

    const first = submitPendingTransaction(store, firstSend);
    const second = submitPendingTransaction(store, secondSend);
    expect(store.current?.status).toBe("submitting");
    await vi.waitFor(() => {
      expect(firstSend).toHaveBeenCalledTimes(1);
    });

    expect(secondSend).not.toHaveBeenCalled();
    sent.resolve(SENT);
    await expect(Promise.all([first, second])).resolves.toEqual([SENT, SENT]);
    expect(pendingHash(store)).toBe(txHash);
    await expect(submitPendingTransaction(store, secondSend)).resolves.toEqual(SENT);
    expect(secondSend).not.toHaveBeenCalled();
  });

  it("clears a rejected current submission owner", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const rejected = Promise.withResolvers<SignAndSendTransactionResult>();
    const attempt = submitPendingTransaction(store, async () => {
      return rejected.promise;
    });

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(store.current).toBeUndefined();
  });

  it("keeps a send whose answer was lost pending under its hash", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const lost: SignAndSendTransactionResult = {
      ok: false,
      reason: "maybe-sent",
      txHash,
      cause: new TypeError("fetch"),
    };
    const attempt = submitPendingTransaction(store, async () => {
      await Promise.resolve();
      return lost;
    });

    await expect(attempt).resolves.toBe(lost);
    expect(pendingHash(store)).toBe(txHash);
  });

  it.each<SignAndSendTransactionResult>([
    { ok: false, reason: "not-signed", cause: new Error(walletRejected) },
    { ok: false, reason: "expired" },
  ])("clears a send that sent nothing: $reason", async (unsent) => {
    const store = createPendingTransactionStore(ignoreChange);

    await expect(
      submitPendingTransaction(store, async () => {
        await Promise.resolve();
        return unsent;
      }),
    ).resolves.toBe(unsent);
    expect(store.current).toBeUndefined();
  });
});

describe("pending transaction late settlement", () => {
  it("does not let a late rejection clear a newer owner", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const rejected = Promise.withResolvers<SignAndSendTransactionResult>();
    const attempt = submitPendingTransaction(store, async () => {
      return rejected.promise;
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

  it("does not let a late rejection clear a newer submission or a cleared record", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const rejected = Promise.withResolvers<SignAndSendTransactionResult>();
    const attempt = submitPendingTransaction(store, async () => rejected.promise);
    await Promise.resolve();
    clearPendingTransaction(store);
    const newer = Promise.withResolvers<SignAndSendTransactionResult>();
    const newerAttempt = submitPendingTransaction(store, async () => newer.promise);

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(store.current).toEqual({ status: "submitting", result: newerAttempt });

    clearPendingTransaction(store);
    newer.reject(new Error(walletRejected));
    await expect(newerAttempt).rejects.toThrow(walletRejected);
    expect(store.current).toBeUndefined();
  });

  it("does not let a late hash replace a newer pending transaction", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const sent = Promise.withResolvers<SignAndSendTransactionResult>();
    const attempt = submitPendingTransaction(store, async () => sent.promise);
    await Promise.resolve();
    const newerHash = `0x${"cd".repeat(32)}` as const;
    clearPendingTransaction(store);
    await recordPending(store, newerHash);

    sent.resolve(SENT);

    await expect(attempt).resolves.toEqual(SENT);
    expect(pendingHash(store)).toBe(newerHash);
  });

  it("does not restore a submission that was explicitly cleared", async () => {
    const store = createPendingTransactionStore(ignoreChange);
    const sent = Promise.withResolvers<SignAndSendTransactionResult>();
    const attempt = submitPendingTransaction(store, async () => sent.promise);
    await Promise.resolve();
    clearPendingTransaction(store);

    sent.resolve(SENT);

    await expect(attempt).resolves.toEqual(SENT);
    expect(store.current).toBeUndefined();
  });
});

function pendingHash(store: PendingTransactionStore): ccc.Hex | undefined {
  return store.current?.status === "pending" ? store.current.txHash : undefined;
}
