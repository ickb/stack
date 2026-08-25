import type { ccc } from "@ckb-ccc/ccc";
import type { WalletConfig } from "../shared/utils.ts";

type PendingTransactionChain = WalletConfig["chain"];
type PendingTransactionAccount = Pick<WalletConfig, "chain" | "address">;
type PendingTransactionCache = Pick<WalletConfig, "chain" | "address" | "queryClient">;

interface PendingTransactionSubmission {
  readonly result: Promise<ccc.Hex>;
}

/**
 * Current-session ownership only: a new QueryClient or a reload starts with no
 * pending identity, and the next action rebuilds from committed cells.
 */
export type PendingTransactionState =
  | Readonly<{ status: "submitting"; owner: PendingTransactionSubmission }>
  | Readonly<{ status: "pending"; txHash: ccc.Hex }>;

export type PendingTransactionQueryKey = readonly [
  PendingTransactionChain,
  string,
  "pendingTransactionConfirmation",
];

export function pendingTransactionQueryKey(
  walletConfig: PendingTransactionAccount,
): PendingTransactionQueryKey {
  return [walletConfig.chain, walletConfig.address, "pendingTransactionConfirmation"];
}

export function pendingTransactionHash(
  walletConfig: PendingTransactionCache,
): ccc.Hex | undefined {
  const state = pendingTransactionState(walletConfig);
  return state?.status === "pending" ? state.txHash : undefined;
}

export function pendingTransactionState(
  walletConfig: PendingTransactionCache,
): PendingTransactionState | undefined {
  return (
    walletConfig.queryClient.getQueryData<PendingTransactionState | null>(
      pendingTransactionQueryKey(walletConfig),
    ) ?? undefined
  );
}

// eslint-disable-next-line @typescript-eslint/promise-function-async -- Every non-owner must receive the exact shared submission promise.
export function submitPendingTransaction(
  walletConfig: PendingTransactionCache,
  submit: (recordTxHash: (txHash: ccc.Hex) => void) => Promise<ccc.Hex>,
): Promise<ccc.Hex> {
  const completion = Promise.withResolvers<ccc.Hex>();
  const owner: PendingTransactionSubmission = { result: completion.promise };
  const submission: PendingTransactionState = { status: "submitting", owner };
  const queryKey = pendingTransactionQueryKey(walletConfig);
  // Infinite gcTime keeps the hash retryable for the whole session, whatever the global policy.
  walletConfig.queryClient.setQueryDefaults(queryKey, { gcTime: Infinity });
  const current = pendingTransactionState(walletConfig) ?? submission;
  walletConfig.queryClient.setQueryData<PendingTransactionState | null>(
    queryKey,
    current,
  );

  if (current.status === "pending") {
    return Promise.resolve(current.txHash);
  }
  if (current.owner !== owner) {
    return current.owner.result;
  }

  void Promise.resolve()
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Adopt synchronous throws without wrapping the submission result again.
    .then(() =>
      submit((txHash) => {
        storeSubmissionHash(walletConfig, owner, txHash);
      }),
    )
    .then(
      (txHash) => {
        storeSubmissionHash(walletConfig, owner, txHash);
        completion.resolve(txHash);
        return null;
      },
      (error: unknown) => {
        clearSubmission(walletConfig, owner);
        completion.reject(error);
        return null;
      },
    );
  return completion.promise;
}

export function clearPendingTransactionHash(walletConfig: PendingTransactionCache): void {
  walletConfig.queryClient.setQueryData<PendingTransactionState | null>(
    pendingTransactionQueryKey(walletConfig),
    null,
  );
  walletConfig.queryClient.removeQueries({
    queryKey: pendingTransactionQueryKey(walletConfig),
    exact: true,
  });
}

function storeSubmissionHash(
  walletConfig: PendingTransactionCache,
  owner: PendingTransactionSubmission,
  txHash: ccc.Hex,
): void {
  const queryKey = pendingTransactionQueryKey(walletConfig);
  const current = walletConfig.queryClient.getQueryData<PendingTransactionState | null>(
    queryKey,
  );
  if (current?.status !== "submitting" || current.owner !== owner) {
    return;
  }
  walletConfig.queryClient.setQueryData<PendingTransactionState | null>(queryKey, () => ({
    status: "pending",
    txHash,
  }));
}

function clearSubmission(
  walletConfig: PendingTransactionCache,
  owner: PendingTransactionSubmission,
): void {
  const queryKey = pendingTransactionQueryKey(walletConfig);
  const current = walletConfig.queryClient.setQueryData<PendingTransactionState | null>(
    queryKey,
    (cached) =>
      cached?.status === "submitting" && cached.owner === owner ? null : cached,
  );
  if (current === null) {
    walletConfig.queryClient.removeQueries({ queryKey, exact: true });
  }
}
