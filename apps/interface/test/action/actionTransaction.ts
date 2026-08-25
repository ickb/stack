import { ccc } from "@ckb-ccc/ccc";
import {
  TransactionBroadcastError,
  TransactionWaitError,
  type signAndSendTransaction as sdkSignAndSendTransaction,
  type waitTransaction as sdkWaitTransaction,
} from "@ickb/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmationWindowMs,
  retryConfirmation,
  transact,
  waitForConfirmation,
  type RefreshedTransactionPreview,
  type RefreshedTransactionState,
} from "../../src/action/actionTransaction.ts";
import { l1StateQueryKey } from "../../src/query/l1StateQueryKey.ts";
import {
  pendingTransactionHash,
  submitPendingTransaction,
  type PendingTransactionState,
} from "../../src/query/pendingTransactionQuery.ts";
import type { TxInfo, WalletConfig } from "../../src/shared/utils.ts";
import { waitCallOptions } from "../support/wait.ts";
import { txWithInput } from "./fixtures/transaction.ts";

const nothingToDo = "Nothing to do";
const rpcUnavailable = "RPC unavailable";
const freshStateId = "fresh-state";
const txHash = `0x${"ab".repeat(32)}` as const;

const { signAndSendTransaction, waitTransaction } = vi.hoisted(() => ({
  signAndSendTransaction: vi.fn<typeof sdkSignAndSendTransaction>(),
  waitTransaction: vi.fn<typeof sdkWaitTransaction>(),
}));

vi.mock(import("@ickb/sdk"), async (importActual) => ({
  ...(await importActual()),
  signAndSendTransaction,
  waitTransaction,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  signAndSendTransaction.mockReset();
  signAndSendTransaction.mockImplementation(async (_signer, _tx, recordTxHash) => {
    recordTxHash?.(txHash);
    await Promise.resolve();
    return txHash;
  });
  waitTransaction.mockReset();
  vi.unstubAllGlobals();
});

describe("finite-window confirmation", () => {
  it("observes one finite window and surfaces its timeout honestly", async () => {
    const timeout = new ccc.ErrorClientWaitTransactionTimeout(confirmationWindowMs);
    waitTransaction.mockRejectedValueOnce(timeout);
    const config = walletConfig();
    const controller = new AbortController();

    await expect(
      waitForConfirmation(config.cccClient, txHash, controller.signal),
    ).rejects.toBe(timeout);

    expect(waitTransaction).toHaveBeenCalledTimes(1);
    expect(waitTransaction).toHaveBeenCalledWith(config.cccClient, txHash, {
      timeout: confirmationWindowMs,
      signal: controller.signal,
    });
  });

  it("keeps an unconfirmed hash pending with current-session wording", async () => {
    waitTransaction.mockRejectedValueOnce(
      new ccc.ErrorClientWaitTransactionTimeout(confirmationWindowMs),
    );
    const calls = transactionCalls();

    await transact(calls);

    expect(calls.setFailure).toHaveBeenCalledWith(
      `Transaction ${txHash} is still unconfirmed after 60s. It may still confirm; check again.`,
      freshStateId,
    );
    expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
  });
});

describe("transact fresh preview boundary", () => {
  it("freezes and sends only the freshly rebuilt transaction", async () => {
    vi.useFakeTimers();
    waitTransaction.mockResolvedValueOnce(committedResponse());
    const cachedTx = activeTxInfo("11").tx;
    const freshTxInfo = activeTxInfo("22", {
      fee: 9n,
      estimatedMaturity: 123n,
      conversionKind: "direct-plus-order",
    });
    const preview = refreshedPreview({ txInfo: freshTxInfo, stateId: freshStateId });
    const build = vi.fn(async () => {
      await Promise.resolve();
      return freshTxInfo;
    });
    const calls = transactionCalls(preview, build);
    const promise = transact(calls);

    await vi.runAllTimersAsync();
    await promise;

    expect(calls.lockIntent).toHaveBeenCalledTimes(1);
    expect(calls.refreshPreview).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(calls.freezePreview).toHaveBeenCalledWith(preview);
    expect(vi.mocked(calls.freezePreview).mock.invocationCallOrder[0]).toBeLessThan(
      signAndSendTransaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(signAndSendTransaction.mock.calls[0]?.[0]).toBe(calls.walletConfig.signer);
    expect(signAndSendTransaction.mock.calls[0]?.[1]).toBe(freshTxInfo.tx);
    expect(signAndSendTransaction.mock.calls[0]?.[1]).not.toBe(cachedTx);
    expect(typeof signAndSendTransaction.mock.calls[0]?.[2]).toBe("function");
    expect(calls.formReset).toHaveBeenCalledTimes(1);
    expect(walletQueryClient(calls.walletConfig).invalidateQueries).toHaveBeenCalledWith({
      queryKey: l1StateQueryKey(calls.walletConfig),
      exact: true,
    });
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(pendingTransactionHash(calls.walletConfig)).toBeUndefined();
  });

  it("surfaces refresh failure and unlocks without sending", async () => {
    const calls = transactionCalls();
    calls.refreshPreview.mockRejectedValueOnce(new Error("refresh failed"));

    await transact(calls);

    expect(calls.setFailure).toHaveBeenCalledWith("refresh failed", undefined);
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(pendingTransactionHash(calls.walletConfig)).toBeUndefined();
  });

  it.each([
    [{ error: "fresh preview failed" }, "fresh preview failed"],
    [{ tx: ccc.Transaction.default() }, nothingToDo],
    [{ fee: 0n }, "Transaction fee is missing or invalid"],
  ] as const)("rejects invalid refreshed preview %#", async (overrides, failure) => {
    const preview = refreshedPreview({
      txInfo: activeTxInfo("22", overrides),
      stateId: freshStateId,
    });
    const calls = transactionCalls(preview);

    await transact(calls);

    expect(calls.setFailure).toHaveBeenCalledWith(failure, freshStateId);
    expect(calls.freezePreview).toHaveBeenNthCalledWith(1, preview);
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
});

describe("transact post-broadcast outcomes", () => {
  it("adopts a hash cached at the final broadcast gate", async () => {
    const releasePreview = Promise.withResolvers<undefined>();
    const calls = {
      ...transactionCalls(),
      yieldForPreview: vi.fn(async () => releasePreview.promise),
    };
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    });

    await recordPending(calls.walletConfig);
    waitTransaction.mockResolvedValueOnce(committedResponse());
    releasePreview.resolve(undefined);
    await attempt;

    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(waitTransaction).toHaveBeenCalledWith(calls.walletConfig.cccClient, txHash, {
      timeout: confirmationWindowMs,
      signal: calls.signal,
    });
  });

  it("retains raw uncertainty and retries the same hash without rebroadcast", async () => {
    waitTransaction.mockRejectedValueOnce(new Error(rpcUnavailable));
    const calls = transactionCalls();

    await transact(calls);

    expect(calls.setFailure).toHaveBeenCalledWith(
      `${rpcUnavailable}. Hash: ${txHash}`,
      freshStateId,
    );
    expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);

    vi.useFakeTimers();
    waitTransaction.mockResolvedValueOnce(committedResponse());
    const retry = retryConfirmation({ ...calls, txHash });
    await vi.runAllTimersAsync();
    await retry;

    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(waitTransaction).toHaveBeenCalledTimes(2);
  });
});

describe("transact broadcast identity and rejection", () => {
  it("stores signed identity before an ambiguous send and does not release it", async () => {
    signAndSendTransaction.mockImplementationOnce(async (_signer, _tx, recordTxHash) => {
      await Promise.resolve();
      recordTxHash?.(txHash);
      throw new TransactionBroadcastError(txHash, {
        cause: new TypeError(rpcUnavailable),
      });
    });
    const calls = transactionCalls();

    await transact(calls);

    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
    expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    expect(calls.setFailure).toHaveBeenCalledWith(
      `Transaction ${txHash} broadcast outcome is unresolved`,
      freshStateId,
    );
    expect(waitTransaction).not.toHaveBeenCalled();
  });

  it("retains pending identity when the node returns a different hash", async () => {
    const nodeTxHash = `0x${"de".repeat(32)}` as const;
    signAndSendTransaction.mockImplementationOnce(async (_signer, _tx, recordTxHash) => {
      await Promise.resolve();
      recordTxHash?.(txHash);
      throw new TransactionBroadcastError(txHash, { nodeTxHash });
    });
    const calls = transactionCalls();

    await transact(calls);

    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
    expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    expect(calls.setFailure).toHaveBeenCalledWith(
      `Node returned transaction hash ${nodeTxHash}, expected ${txHash}`,
      freshStateId,
    );
    expect(waitTransaction).not.toHaveBeenCalled();
  });

  it("releases a rejected send without resetting the form", async () => {
    waitTransaction.mockRejectedValueOnce(
      new TransactionWaitError(txHash, {
        status: "rejected",
        reason: "validation failed",
      }),
    );
    const calls = transactionCalls();

    await transact(calls);

    expect(calls.setFailure).toHaveBeenCalledWith(
      `Transaction rejected: validation failed. Hash: ${txHash}`,
      freshStateId,
    );
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(pendingTransactionHash(calls.walletConfig)).toBeUndefined();
  });
});

describe("retryConfirmation", () => {
  it("silently ignores retry after its owner has already unmounted", async () => {
    const controller = new AbortController();
    const calls = transactionCalls(refreshedPreview(), undefined, controller);
    await recordPending(calls.walletConfig);
    controller.abort();

    await retryConfirmation({ ...calls, txHash });

    expect(waitTransaction).not.toHaveBeenCalled();
    expect(calls.setFailure).not.toHaveBeenCalled();
    expect(calls.setIsConfirming).not.toHaveBeenCalled();
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
  });

  it("releases a terminal rejection found while retrying", async () => {
    waitTransaction.mockRejectedValueOnce(
      new TransactionWaitError(txHash, {
        status: "rejected",
        reason: "conflicting input",
      }),
    );
    const calls = transactionCalls();
    await recordPending(calls.walletConfig);

    await retryConfirmation({ ...calls, txHash });

    expect(calls.setFailure).toHaveBeenCalledWith(
      `Transaction rejected: conflicting input. Hash: ${txHash}`,
    );
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(pendingTransactionHash(calls.walletConfig)).toBeUndefined();
  });

  it("falls back to terminal status when retry rejection has no reason", async () => {
    waitTransaction.mockRejectedValueOnce(
      new TransactionWaitError(txHash, { status: "rejected" }),
    );
    const calls = transactionCalls();

    await retryConfirmation({ ...calls, txHash });

    expect(calls.setFailure).toHaveBeenCalledWith(
      `Transaction rejected: rejected. Hash: ${txHash}`,
    );
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
  });

  it("keeps an uncertain hash frozen when retry polling fails", async () => {
    waitTransaction.mockRejectedValueOnce(new Error(rpcUnavailable));
    const calls = transactionCalls();

    await retryConfirmation({ ...calls, txHash });

    expect(calls.setFailure).toHaveBeenCalledWith(`${rpcUnavailable}. Hash: ${txHash}`);
    expect(calls.freezePreview).not.toHaveBeenCalled();
  });
});

describe("attempt ownership during refresh", () => {
  it("suppresses callbacks when refresh resolves as ownership aborts", async () => {
    const controller = new AbortController();
    const deferred = Promise.withResolvers<RefreshedTransactionState>();
    const preview = refreshedPreview();
    const calls = transactionCalls(preview, undefined, controller);
    calls.refreshPreview.mockReturnValueOnce(deferred.promise);
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(calls.refreshPreview).toHaveBeenCalledTimes(1);
    });
    const callbackCounts = attemptCallbackCounts(calls);

    deferred.resolve(refreshedState(preview));
    controller.abort();
    await attempt;
    await Promise.resolve();

    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(calls.freezePreview).not.toHaveBeenCalled();
    expect(calls.setFailure).toHaveBeenCalledTimes(1);
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(attemptCallbackCounts(calls)).toEqual(callbackCounts);
  });
});

describe("attempt ownership during fresh build", () => {
  it("suppresses preview callbacks when build resolves as ownership aborts", async () => {
    const controller = new AbortController();
    const built = Promise.withResolvers<TxInfo>();
    const build = vi.fn(async () => built.promise);
    const calls = transactionCalls(refreshedPreview(), build, controller);
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(build).toHaveBeenCalledTimes(1);
    });

    built.resolve(refreshedPreview().txInfo);
    controller.abort();
    await attempt;

    expect(calls.freezePreview).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
});

describe("attempt ownership during preview render yield", () => {
  it("does not enter signing when the render yield resolves as ownership aborts", async () => {
    const controller = new AbortController();
    const rendered = Promise.withResolvers<undefined>();
    const calls = {
      ...transactionCalls(refreshedPreview(), undefined, controller),
      yieldForPreview: vi.fn(async () => rendered.promise),
    };
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(calls.freezePreview).toHaveBeenCalledTimes(1);
    });
    const callbackCounts = attemptCallbackCounts(calls);

    rendered.resolve(undefined);
    controller.abort();
    await attempt;

    expect(attemptCallbackCounts(calls)).toEqual(callbackCounts);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });
});

describe("attempt ownership during send", () => {
  it("persists a late sent hash without owner callbacks", async () => {
    const controller = new AbortController();
    const sent = Promise.withResolvers<ccc.Hex>();
    const calls = transactionCalls(refreshedPreview(), undefined, controller);
    signAndSendTransaction.mockImplementationOnce(async (_signer, _tx, recordTxHash) => {
      const hash = await sent.promise;
      recordTxHash?.(hash);
      return hash;
    });
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    });
    const callbackCounts = attemptCallbackCounts(calls);

    sent.resolve(txHash);
    controller.abort();
    await attempt;
    await vi.waitFor(() => {
      expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
    });

    expect(attemptCallbackCounts(calls)).toEqual(callbackCounts);
  });
});

describe("attempt ownership after broadcast", () => {
  it("cancels SDK wait ownership and retries the cached hash without another send", async () => {
    const controller = new AbortController();
    let ownsWait = false;
    waitTransaction.mockImplementationOnce(async (...args) => {
      const { signal } = waitCallOptions(args);
      if (signal === undefined) {
        throw new Error("Missing confirmation signal");
      }
      ownsWait = true;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            ownsWait = false;
            reject(new Error("confirmation stopped"));
          },
          { once: true },
        );
      });
    });
    const calls = transactionCalls(refreshedPreview(), undefined, controller);
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(waitTransaction).toHaveBeenCalledTimes(1);
    });
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
    const callbackCounts = attemptCallbackCounts(calls);

    controller.abort();
    await attempt;

    expect(waitTransaction).toHaveBeenCalledTimes(1);
    expect(waitCallOptions(waitTransaction.mock.calls[0]).signal).toBe(controller.signal);
    expect(ownsWait).toBe(false);
    expect(attemptCallbackCounts(calls)).toEqual(callbackCounts);
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(
      walletQueryClient(calls.walletConfig).invalidateQueries,
    ).not.toHaveBeenCalled();
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);

    const retryController = new AbortController();
    waitTransaction.mockResolvedValueOnce(committedResponse());
    await retryConfirmation({
      ...calls,
      signal: retryController.signal,
      txHash,
    });

    expect(waitTransaction).toHaveBeenCalledTimes(2);
    expect(waitCallOptions(waitTransaction.mock.calls[1]).signal).toBe(
      retryController.signal,
    );
    expect(retryController.signal).not.toBe(controller.signal);
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
  });
});

/** Establishes pending state exactly as a completed submission does. */
async function recordPending(walletConfig: WalletConfig): Promise<void> {
  await submitPendingTransaction(walletConfig, async (recordTxHash) => {
    recordTxHash(txHash);
    await Promise.resolve();
    return txHash;
  });
}

function committedResponse(): ccc.ClientTransactionResponse {
  return new ccc.ClientTransactionResponse(
    ccc.Transaction.default(),
    "committed",
    undefined,
    `0x${"cd".repeat(32)}`,
    10n,
  );
}

function attemptCallbackCounts(calls: Parameters<typeof transact>[0]): number[] {
  return [
    vi.mocked(calls.freezePreview).mock.calls.length,
    vi.mocked(calls.setMessage).mock.calls.length,
    vi.mocked(calls.setFailure).mock.calls.length,
    vi.mocked(calls.setIsPreparing).mock.calls.length,
    vi.mocked(calls.setIsConfirming).mock.calls.length,
    vi.mocked(calls.formReset).mock.calls.length,
  ];
}

describe("attempt ownership during completion", () => {
  it("does not reset or clear the hash when unmounted during invalidation", async () => {
    const controller = new AbortController();
    const invalidation = Promise.withResolvers<undefined>();
    waitTransaction.mockResolvedValueOnce(committedResponse());
    const calls = transactionCalls(refreshedPreview(), undefined, controller);
    walletQueryClient(calls.walletConfig).invalidateQueries.mockReturnValueOnce(
      invalidation.promise,
    );
    const attempt = transact(calls);
    await vi.waitFor(() => {
      expect(
        walletQueryClient(calls.walletConfig).invalidateQueries,
      ).toHaveBeenCalledTimes(1);
    });

    invalidation.resolve(undefined);
    controller.abort();
    await attempt;
    await Promise.resolve();

    expect(calls.formReset).not.toHaveBeenCalled();
    expect(calls.freezePreview).not.toHaveBeenCalledWith(undefined);
    expect(pendingTransactionHash(calls.walletConfig)).toBe(txHash);
  });
});

function transactionCalls(
  preview = refreshedPreview(),
  build?: () => Promise<TxInfo>,
  controller = new AbortController(),
): Parameters<typeof transact>[0] & {
  refreshPreview: ReturnType<typeof vi.fn<() => Promise<RefreshedTransactionState>>>;
} {
  const buildPreview =
    build ??
    vi.fn(async () => {
      await Promise.resolve();
      return preview.txInfo;
    });
  const state = {
    stateId: preview.stateId,
    tipTimestamp: preview.tipTimestamp,
    hasCollectable: preview.hasCollectable,
  };
  return {
    lockIntent: vi.fn<() => void>(),
    refreshPreview: vi.fn(async () => {
      await Promise.resolve();
      return { ...state, build: buildPreview };
    }),
    freezePreview: vi.fn<(value: RefreshedTransactionPreview | undefined) => void>(),
    setMessage: vi.fn<(message: string) => void>(),
    setFailure: vi.fn<(failure: string, stateId?: string) => void>(),
    setIsPreparing: vi.fn<(isPreparing: boolean) => void>(),
    setIsConfirming: vi.fn<(isConfirming: boolean) => void>(),
    formReset: vi.fn<() => void>(),
    walletConfig: walletConfig(),
    unavailableMessage: nothingToDo,
    signal: controller.signal,
  };
}

function refreshedPreview(
  overrides: Partial<RefreshedTransactionPreview> = {},
): RefreshedTransactionPreview {
  return {
    txInfo: activeTxInfo("22"),
    stateId: freshStateId,
    tipTimestamp: 10n,
    hasCollectable: true,
    ...overrides,
  };
}

function refreshedState(preview: RefreshedTransactionPreview): RefreshedTransactionState {
  return {
    stateId: preview.stateId,
    tipTimestamp: preview.tipTimestamp,
    hasCollectable: preview.hasCollectable,
    build: async (): Promise<TxInfo> => {
      await Promise.resolve();
      return preview.txInfo;
    },
  };
}

function walletConfig(): WalletConfig {
  const queryClient = walletQueryClient();
  const cccClient = {};
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Minimal wallet config double exposes only fields read by transaction lifecycle code.
  return {
    address: "ckt1test",
    chain: "testnet",
    cccClient,
    signer: { client: cccClient },
    accountLocks: [{ toHex: () => "0x22" }],
    primaryLock: { toHex: () => "0x11" },
    queryClient,
    sdk: {},
  } as unknown as WalletConfig;
}

function walletQueryClient(config?: WalletConfig): {
  getQueryData: ReturnType<typeof vi.fn>;
  invalidateQueries: ReturnType<typeof vi.fn>;
  removeQueries: ReturnType<typeof vi.fn>;
  setQueryData: ReturnType<typeof vi.fn>;
  setQueryDefaults: ReturnType<typeof vi.fn>;
} {
  if (config !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Test wallet config stores the query client mock under the production field.
    return config.queryClient as unknown as {
      getQueryData: ReturnType<typeof vi.fn>;
      invalidateQueries: ReturnType<typeof vi.fn>;
      removeQueries: ReturnType<typeof vi.fn>;
      setQueryData: ReturnType<typeof vi.fn>;
      setQueryDefaults: ReturnType<typeof vi.fn>;
    };
  }
  type CacheValue = PendingTransactionState | null;
  const data = new Map<string, CacheValue>();
  const cacheKey = (queryKey: readonly unknown[]): string => JSON.stringify(queryKey);
  return {
    getQueryData: vi.fn((queryKey: readonly unknown[]) => data.get(cacheKey(queryKey))),
    invalidateQueries: vi.fn(async () => {
      await Promise.resolve();
    }),
    removeQueries: vi.fn((filters: { queryKey: readonly unknown[] }) => {
      data.delete(cacheKey(filters.queryKey));
    }),
    setQueryData: vi.fn(
      (
        queryKey: readonly unknown[],
        updater:
          CacheValue | ((cached: CacheValue | undefined) => CacheValue | undefined),
      ) => {
        const key = cacheKey(queryKey);
        const value = typeof updater === "function" ? updater(data.get(key)) : updater;
        if (value !== undefined) {
          data.set(key, value);
        }
        return value;
      },
    ),
    setQueryDefaults: vi.fn(),
  };
}

function activeTxInfo(byte: string, overrides: Partial<TxInfo> = {}): TxInfo {
  return {
    tx: txWithInput(byte),
    error: "",
    fee: 1n,
    estimatedMaturity: 0n,
    conversionKind: "order",
    ...overrides,
  };
}
