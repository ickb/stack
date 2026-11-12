import type { ickb } from "@ickb/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transact,
  type AttemptPhase,
  type RefreshedTransactionPreview,
} from "../../src/action/actionTransaction.ts";
import { l1StateQueryKey, type L1StateType } from "../../src/app/queries.ts";
import type { TxInfo, WalletConfig } from "../../src/shared/utils.ts";
import { l1State } from "../app/fixtures/l1State.ts";
import { activeTxInfo } from "./fixtures/transaction.ts";

const freshStateId = "fresh-state";
const txHash = `0x${"ab".repeat(32)}` as const;
const waiting = `Transaction ${txHash} sent. Waiting for network confirmation...`;

const { commitTransaction } = vi.hoisted(() => ({
  commitTransaction: vi.fn<typeof ickb.commitTransaction>(),
}));

vi.mock(import("@ickb/sdk"), async (importActual) => {
  const { ickb: actual } = await importActual();
  return { ickb: { ...actual, commitTransaction } };
});

/** Every commit from here on yields `steps`. */
function committing(...steps: ickb.CommitStep[]): void {
  commitTransaction.mockImplementation(async function* () {
    for (const step of steps) {
      await Promise.resolve();
      yield step;
    }
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  committing(
    { ok: true, status: "sent", txHash },
    { ok: true, status: "committed", txHash },
  );
});

describe("transact fresh preview boundary", () => {
  it("freezes, then commits only the freshly rebuilt transaction", async () => {
    committing(
      { ok: true, status: "sent", txHash },
      { ok: true, status: "committed", txHash },
    );
    vi.useFakeTimers();
    const cachedTx = activeTxInfo("11").tx;
    const freshTxInfo = activeTxInfo("22", {
      plannedFee: 9n,
      estimatedMaturity: 123n,
      conversionKind: "direct-plus-order",
    });
    const build = vi.fn(async () => {
      await Promise.resolve();
      return freshTxInfo;
    });
    const preview = refreshedPreview({ txInfo: freshTxInfo, txBuilder: build });
    const calls = transactionCalls(preview);
    const promise = transact(calls);

    await vi.runAllTimersAsync();
    await promise;

    expect(calls.refreshState).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledExactlyOnceWith(true, 1n);
    expect(calls.freezePreview).toHaveBeenCalledWith(preview);
    expect(vi.mocked(calls.freezePreview).mock.invocationCallOrder[0]).toBeLessThan(
      commitTransaction.mock.invocationCallOrder[0] ?? 0,
    );
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction.mock.calls[0]?.[0]).toBe(calls.walletConfig.signer);
    // The whole build result goes to the commit, so its deadline cannot be dropped.
    expect(commitTransaction.mock.calls[0]?.[1]).toBe(freshTxInfo);
    expect(commitTransaction.mock.calls[0]?.[1].tx).not.toBe(cachedTx);
    expect(calls.setMessage).toHaveBeenCalledWith(waiting);
    expect(calls.setMessage).toHaveBeenCalledWith("Transaction confirmed.");
    expect(calls.formReset).toHaveBeenCalledTimes(1);
    expect(walletQueryClient(calls.walletConfig).invalidateQueries).toHaveBeenCalledWith({
      queryKey: l1StateQueryKey(calls.walletConfig),
      exact: true,
    });
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(calls.setMessage).toHaveBeenLastCalledWith("");
    expect(phases(calls)).toEqual(["preparing", "confirming", "idle"]);
  });

  it("surfaces refresh failure and unlocks without sending", async () => {
    const calls = transactionCalls();
    calls.refreshState.mockRejectedValueOnce(new Error("refresh failed"));

    await transact(calls);

    expect(calls.setFailure).toHaveBeenLastCalledWith("refresh failed");
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(phases(calls)).toEqual(["preparing", "idle"]);
  });

  it("refuses a refreshed preview that failed, without freezing it", async () => {
    const calls = transactionCalls(
      refreshedPreview({
        txBuilder: async () => {
          await Promise.resolve();
          return { ok: false, error: "fresh preview failed" };
        },
      }),
    );

    await transact(calls);

    expect(calls.setFailure).toHaveBeenLastCalledWith("fresh preview failed");
    expect(vi.mocked(calls.freezePreview).mock.calls).toEqual([[undefined]]);
    expect(commitTransaction).not.toHaveBeenCalled();
  });
});

describe("transact commit steps", () => {
  it("shows the first broadcast's answer, then each pending step's cause as a retry", async () => {
    committing(
      { ok: true, status: "sent", txHash, cause: new TypeError("fetch failed") },
      { ok: true, status: "pending", txHash },
      { ok: true, status: "pending", txHash, cause: new Error("node lagging") },
      { ok: true, status: "committed", txHash },
    );
    const calls = transactionCalls();

    await transact(calls);

    expect(vi.mocked(calls.setMessage).mock.calls).toEqual([
      ["Refreshing transaction preview..."],
      [
        "Part converts at a fixed time, the rest when a bot fills it, estimated below. Includes 295 CKB of cell space, returned when collected. Also collects converted funds. Confirm the transaction in your wallet.",
      ],
      [`${waiting} The node answered: fetch failed`],
      [waiting],
      [`${waiting} Retrying: node lagging`],
      ["Transaction confirmed."],
      [""],
    ]);
    expect(calls.setFailure).toHaveBeenLastCalledWith("");
    expect(calls.formReset).toHaveBeenCalledTimes(1);
  });

  it("releases the preview on a declined signature, showing no failure", async () => {
    committing({
      ok: false,
      reason: "not-signed",
      txHash,
      cause: new Error("User rejected"),
    });
    const calls = transactionCalls();

    await transact(calls);

    // The draft returns as it was: a message set now would never render once released.
    expect(calls.setMessage).toHaveBeenCalledTimes(2);
    expect(calls.setFailure).toHaveBeenLastCalledWith("");
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(calls.formReset).not.toHaveBeenCalled();
    expect(phases(calls)).toEqual(["preparing", "confirming", "idle"]);
  });

  it.each([
    {
      step: { ok: false, reason: "expired", txHash },
      failure:
        "The withdrawal timing changed while you were signing. Nothing was sent. Review the refreshed preview and sign again.",
    },
    {
      step: { ok: false, reason: "abandoned", txHash, cause: new Error("fetch failed") },
      failure: `The withdrawal deadline passed before the network took the transaction, so it is no longer sent. An earlier copy may still land. Hash: ${txHash}`,
    },
    {
      step: { ok: false, reason: "rejected", txHash, cause: new Error("dead input") },
      failure: `Transaction rejected: dead input. Hash: ${txHash}`,
    },
    {
      step: { ok: false, reason: "rejected", txHash },
      failure: `Transaction rejected: the node gave no reason. Hash: ${txHash}`,
    },
  ] satisfies Array<{ step: ickb.CommitStep; failure: string }>)(
    "releases the unchanged form with a message on $step.reason",
    async ({ step, failure }) => {
      committing({ ok: true, status: "sent", txHash }, step);
      const calls = transactionCalls();

      await transact(calls);

      expect(calls.setFailure).toHaveBeenLastCalledWith(failure);
      expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
      expect(calls.formReset).not.toHaveBeenCalled();
      expect(
        walletQueryClient(calls.walletConfig).invalidateQueries,
      ).not.toHaveBeenCalled();
      expect(phases(calls).at(-1)).toBe("idle");
    },
  );

  it("shows a failure the commit throws before its broadcast", async () => {
    commitTransaction.mockImplementation(() => {
      throw new Error("Signer altered the transaction inputs, outputs or outputs data");
    });
    const calls = transactionCalls();

    await transact(calls);

    expect(calls.setFailure).toHaveBeenLastCalledWith(
      "Signer altered the transaction inputs, outputs or outputs data",
    );
    expect(calls.freezePreview).toHaveBeenLastCalledWith(undefined);
    expect(phases(calls)).toEqual(["preparing", "confirming", "idle"]);
  });
});

function transactionCalls(preview = refreshedPreview()): Parameters<
  typeof transact
>[0] & {
  refreshState: ReturnType<typeof vi.fn<() => Promise<L1StateType>>>;
} {
  return {
    refreshState: vi.fn(async () => {
      await Promise.resolve();
      return preview;
    }),
    isCkb2Udt: true,
    amount: 1n,
    // No render runs between the preview and the signature here.
    yieldForPreview: async (): Promise<void> => {
      await Promise.resolve();
    },
    freezePreview: vi.fn<(value: RefreshedTransactionPreview | undefined) => void>(),
    setMessage: vi.fn<(message: string) => void>(),
    setFailure: vi.fn<(failure: string) => void>(),
    setPhase: vi.fn<(phase: AttemptPhase) => void>(),
    formReset: vi.fn<() => void>(),
    walletConfig: walletConfig(),
  };
}

/** The phases an attempt went through, in order. */
function phases(calls: Parameters<typeof transact>[0]): AttemptPhase[] {
  return vi.mocked(calls.setPhase).mock.calls.map(([phase]) => phase);
}

/** A fresh state whose builder returns the preview's transaction. */
function refreshedPreview(
  overrides: Partial<RefreshedTransactionPreview> = {},
): RefreshedTransactionPreview {
  const txInfo = overrides.txInfo ?? activeTxInfo("22");
  return {
    ...l1State(),
    stateId: freshStateId,
    hasCollectable: true,
    txInfo,
    txBuilder: async (): Promise<TxInfo> => {
      await Promise.resolve();
      return txInfo;
    },
    ...overrides,
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
    queryClient,
  } as unknown as WalletConfig;
}

function walletQueryClient(config?: WalletConfig): {
  invalidateQueries: ReturnType<typeof vi.fn>;
} {
  if (config !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Test wallet config stores the query client mock under the production field.
    return config.queryClient as unknown as {
      invalidateQueries: ReturnType<typeof vi.fn>;
    };
  }
  return {
    invalidateQueries: vi.fn(async () => {
      await Promise.resolve();
    }),
  };
}
