import type { ccc } from "@ckb-ccc/ccc";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingTransactionHash,
  pendingTransactionHash,
  pendingTransactionQueryKey,
  pendingTransactionState,
  submitPendingTransaction,
  type PendingTransactionState,
} from "../../src/query/pendingTransactionQuery.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";

const txHash = `0x${"ab".repeat(32)}` as const;
const walletRejected = "wallet rejected";

afterEach(() => {
  vi.useRealTimers();
});

describe("pending transaction query", () => {
  it("records hashes for only the exact chain and account", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const otherAccount = config(queryClient, "testnet", "ckt1other");
    const otherChain = config(queryClient, "mainnet", "ckt1account");

    await recordPending(account, txHash);

    expect(pendingTransactionQueryKey(account)).toEqual([
      "testnet",
      "ckt1account",
      "pendingTransactionConfirmation",
    ]);
    expect(pendingTransactionHash(account)).toBe(txHash);
    expect(pendingTransactionHash(otherAccount)).toBeUndefined();
    expect(pendingTransactionHash(otherChain)).toBeUndefined();

    clearPendingTransactionHash(account);
    expect(pendingTransactionHash(account)).toBeUndefined();
  });
});

describe("pending transaction session scope", () => {
  it("gives a replacement QueryClient no pending identity", async () => {
    const account = config(new QueryClient(), "testnet", "ckt1account");
    await recordPending(account, txHash);

    const reloaded = config(new QueryClient(), "testnet", "ckt1account");

    expect(pendingTransactionState(reloaded)).toBeUndefined();
  });
});

describe("pending transaction cache", () => {
  it("survives a shorter global garbage-collection policy until explicit clear", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 5 } },
    });
    const account = config(queryClient, "testnet", "ckt1account");

    await recordPending(account, txHash);
    vi.advanceTimersByTime(100);

    expect(pendingTransactionHash(account)).toBe(txHash);
    clearPendingTransactionHash(account);
    expect(pendingTransactionHash(account)).toBeUndefined();
  });

  it("publishes an exact clear to an attached account observer", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const observer = new QueryObserver<PendingTransactionState | null>(queryClient, {
      queryKey: pendingTransactionQueryKey(account),
      enabled: false,
    });
    const observed: Array<PendingTransactionState | null | undefined> = [];
    const unsubscribe = observer.subscribe((result) => {
      observed.push(result.data);
    });

    await recordPending(account, txHash);
    clearPendingTransactionHash(account);

    expect(observed).toContainEqual({ status: "pending", txHash });
    expect(observer.getCurrentResult().data).toBeNull();
    expect(pendingTransactionHash(account)).toBeUndefined();
    unsubscribe();
  });
});

describe("pending transaction submission ownership", () => {
  it("publishes one submission and reuses it across synchronous callers", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const sent = Promise.withResolvers<typeof txHash>();
    const firstSend = vi.fn(async () => {
      await sent.promise;
      return txHash;
    });
    const secondSend = vi.fn(async () => {
      await Promise.resolve();
      return txHash;
    });

    const first = submitPendingTransaction(account, firstSend);
    const second = submitPendingTransaction(account, secondSend);
    const submitting = pendingTransactionState(account);
    expect(submitting?.status).toBe("submitting");
    expect(
      submitting?.status === "submitting" ? Object.keys(submitting.owner) : [],
    ).toEqual(["result"]);
    await vi.waitFor(() => {
      expect(firstSend).toHaveBeenCalledTimes(1);
    });

    expect(secondSend).not.toHaveBeenCalled();
    sent.resolve(txHash);
    await expect(Promise.all([first, second])).resolves.toEqual([txHash, txHash]);
    expect(pendingTransactionHash(account)).toBe(txHash);
  });

  it("clears a rejected current submission owner", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const rejected = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(account, async () => {
      await rejected.promise;
      return txHash;
    });

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(pendingTransactionState(account)).toBeUndefined();
  });
});

describe("pending transaction late settlement", () => {
  it("does not let a late rejection clear a newer owner", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const rejected = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(account, async () => {
      await rejected.promise;
      return txHash;
    });
    await Promise.resolve();
    const newerHash = `0x${"cd".repeat(32)}` as const;
    // Only a clear frees the account for the newer submission that must survive.
    clearPendingTransactionHash(account);
    await recordPending(account, newerHash);

    rejected.reject(new Error(walletRejected));
    await expect(attempt).rejects.toThrow(walletRejected);
    expect(pendingTransactionHash(account)).toBe(newerHash);
  });

  it("does not let a late hash replace a newer pending transaction", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const sent = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(account, async () => sent.promise);
    await Promise.resolve();
    const newerHash = `0x${"cd".repeat(32)}` as const;
    clearPendingTransactionHash(account);
    await recordPending(account, newerHash);

    sent.resolve(txHash);

    await expect(attempt).resolves.toBe(txHash);
    expect(pendingTransactionHash(account)).toBe(newerHash);
  });

  it("does not restore a submission that was explicitly cleared", async () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const sent = Promise.withResolvers<typeof txHash>();
    const attempt = submitPendingTransaction(account, async () => sent.promise);
    await Promise.resolve();
    clearPendingTransactionHash(account);

    sent.resolve(txHash);

    await expect(attempt).resolves.toBe(txHash);
    expect(pendingTransactionState(account)).toBeUndefined();
  });
});

/** Establishes pending state exactly as a completed submission does. */
async function recordPending(
  account: Pick<WalletConfig, "chain" | "address" | "queryClient">,
  hash: ccc.Hex,
): Promise<void> {
  await submitPendingTransaction(account, async (recordTxHash) => {
    recordTxHash(hash);
    await Promise.resolve();
    return hash;
  });
}

function config(
  queryClient: QueryClient,
  chain: WalletConfig["chain"],
  address: string,
): Pick<WalletConfig, "chain" | "address" | "queryClient"> {
  return { queryClient, chain, address };
}
