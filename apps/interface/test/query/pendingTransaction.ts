import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingTransactionHash,
  hydratePendingTransaction,
  pendingTransactionHash,
  pendingTransactionQueryKey,
  pendingTransactionState,
  storePendingTransactionHash,
  submitPendingTransaction,
  type PendingTransactionState,
} from "../../src/query/pendingTransactionQuery.ts";
import type { WalletConfig } from "../../src/shared/utils.ts";
import { memoryStorage } from "../shared/fixtures/storage.ts";

const txHash = `0x${"ab".repeat(32)}` as const;
const walletRejected = "wallet rejected";

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("pending transaction query", () => {
  it("stores public hashes for only the exact chain and account", () => {
    const queryClient = new QueryClient();
    const account = config(queryClient, "testnet", "ckt1account");
    const otherAccount = config(queryClient, "testnet", "ckt1other");
    const otherChain = config(queryClient, "mainnet", "ckt1account");

    storePendingTransactionHash(account, txHash);

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

describe("pending transaction durable identity", () => {
  it("hydrates strict v1 identity into a fresh QueryClient with chain/account isolation", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    const first = config(new QueryClient(), "testnet", "ckt1account");
    storePendingTransactionHash(first, txHash);

    const reloaded = config(new QueryClient(), "testnet", "ckt1account");
    const otherAccount = config(new QueryClient(), "testnet", "ckt1other");
    const otherChain = config(new QueryClient(), "mainnet", "ckt1account");

    expect(hydratePendingTransaction(reloaded)).toEqual({
      status: "pending",
      txHash,
    });
    expect(hydratePendingTransaction(otherAccount)).toBeUndefined();
    expect(hydratePendingTransaction(otherChain)).toBeUndefined();
  });

  it("ignores malformed durable values and lets memory pending identity win", () => {
    const localStorage = memoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    const durable = config(new QueryClient(), "testnet", "ckt1account");
    storePendingTransactionHash(durable, txHash);
    const [key] = localStorage.keys();
    if (key === undefined) {
      throw new Error("Expected durable pending key");
    }
    localStorage.setItem(key, JSON.stringify({ version: 1, txHash, unexpected: true }));
    expect(
      hydratePendingTransaction(config(new QueryClient(), "testnet", "ckt1account")),
    ).toBeUndefined();

    const memory = config(new QueryClient(), "testnet", "ckt1account");
    const newerHash = `0x${"cd".repeat(32)}` as const;
    storePendingTransactionHash(memory, newerHash);
    localStorage.setItem(key, JSON.stringify({ version: 1, txHash }));
    expect(hydratePendingTransaction(memory)).toEqual({
      status: "pending",
      txHash: newerHash,
    });
  });

  it("treats unavailable storage and storage read errors as no durable identity", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage unavailable");
      },
    });
    expect(
      hydratePendingTransaction(config(new QueryClient(), "testnet", "ckt1account")),
    ).toBeUndefined();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem() {
          throw new Error("storage read failed");
        },
      },
    });
    expect(
      hydratePendingTransaction(config(new QueryClient(), "testnet", "ckt1account")),
    ).toBeUndefined();
  });
});

describe("pending transaction durable admission", () => {
  it("requires browser storage before publishing pending identity", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage unavailable");
      },
    });
    const account = config(new QueryClient(), "testnet", "ckt1account");

    expect(() => {
      storePendingTransactionHash(account, txHash);
    }).toThrow("Durable browser storage is required before broadcasting");
    expect(pendingTransactionState(account)).toBeUndefined();
  });

  it("rejects submission before broadcast when durable identity cannot be stored", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("storage write failed");
      },
    });
    const account = config(new QueryClient(), "testnet", "ckt1account");
    let broadcast = false;

    const attempt = submitPendingTransaction(account, async (recordTxHash) => {
      await Promise.resolve();
      recordTxHash(txHash);
      broadcast = true;
      return txHash;
    });

    await expect(attempt).rejects.toThrow("storage write failed");
    expect(broadcast).toBe(false);
    expect(pendingTransactionState(account)).toBeUndefined();
    expect(
      hydratePendingTransaction(config(new QueryClient(), "testnet", "ckt1account")),
    ).toBeUndefined();
  });
});

describe("pending transaction cache", () => {
  it("survives a shorter global garbage-collection policy until explicit clear", () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { gcTime: 5 } },
    });
    const account = config(queryClient, "testnet", "ckt1account");

    storePendingTransactionHash(account, txHash);
    vi.advanceTimersByTime(100);

    expect(pendingTransactionHash(account)).toBe(txHash);
    clearPendingTransactionHash(account);
    expect(pendingTransactionHash(account)).toBeUndefined();
  });

  it("publishes an exact clear to an attached account observer", () => {
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

    storePendingTransactionHash(account, txHash);
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
    storePendingTransactionHash(account, newerHash);

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
    storePendingTransactionHash(account, newerHash);

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

function config(
  queryClient: QueryClient,
  chain: WalletConfig["chain"],
  address: string,
): Pick<WalletConfig, "chain" | "address" | "queryClient"> {
  return { queryClient, chain, address };
}
