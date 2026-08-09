import { ccc } from "@ckb-ccc/ccc";
import type { WalletConfig } from "../shared/utils.ts";

type PendingTransactionChain = WalletConfig["chain"];
type PendingTransactionAccount = Pick<WalletConfig, "chain" | "address">;
type PendingTransactionCache = Pick<WalletConfig, "chain" | "address" | "queryClient">;

interface PendingTransactionSubmission {
  readonly result: Promise<ccc.Hex>;
}

const pendingTransactionStoragePrefix = "ickb-pending-transaction:v1";
const strictTxHashPattern = /^0x[0-9a-f]{64}$/u;

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

/** Hydrates public pending identity without replacing a live memory owner. */
export function hydratePendingTransaction(
  walletConfig: PendingTransactionCache,
): PendingTransactionState | undefined {
  const queryKey = pendingTransactionQueryKey(walletConfig);
  const current = walletConfig.queryClient.getQueryData<PendingTransactionState | null>(
    queryKey,
  );
  if (current !== undefined) {
    return current ?? undefined;
  }

  const txHash = readStoredTransactionHash(walletConfig);
  if (txHash === undefined) {
    return undefined;
  }
  const pending = { status: "pending", txHash } as const;
  walletConfig.queryClient.setQueryDefaults(queryKey, { gcTime: Infinity });
  walletConfig.queryClient.setQueryData<PendingTransactionState | null>(
    queryKey,
    pending,
  );
  return pending;
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

export function storePendingTransactionHash(
  walletConfig: PendingTransactionCache,
  txHash: ccc.Hex,
): void {
  writeStoredTransactionHash(walletConfig, txHash);
  walletConfig.queryClient.setQueryDefaults(pendingTransactionQueryKey(walletConfig), {
    gcTime: Infinity,
  });
  walletConfig.queryClient.setQueryData<PendingTransactionState | null>(
    pendingTransactionQueryKey(walletConfig),
    () => ({ status: "pending", txHash }),
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
  walletConfig.queryClient.setQueryDefaults(queryKey, { gcTime: Infinity });
  const current = hydratePendingTransaction(walletConfig) ?? submission;
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
  removeStoredTransactionHash(walletConfig);
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
  writeStoredTransactionHash(walletConfig, txHash);
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

function pendingTransactionStorageKey(walletConfig: PendingTransactionAccount): string {
  return `${pendingTransactionStoragePrefix}:${walletConfig.chain}:${encodeURIComponent(walletConfig.address)}`;
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function readStoredTransactionHash(
  walletConfig: PendingTransactionAccount,
): ccc.Hex | undefined {
  try {
    const stored = browserStorage()?.getItem(pendingTransactionStorageKey(walletConfig));
    if (stored === undefined || stored === null) {
      return undefined;
    }
    const value: unknown = JSON.parse(stored);
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !("version" in value) ||
      value.version !== 1 ||
      !("txHash" in value) ||
      typeof value.txHash !== "string" ||
      !strictTxHashPattern.test(value.txHash)
    ) {
      return undefined;
    }
    return ccc.hexFrom(value.txHash);
  } catch {
    return undefined;
  }
}

function writeStoredTransactionHash(
  walletConfig: PendingTransactionAccount,
  txHash: ccc.Hex,
): void {
  const storage = browserStorage();
  if (storage === undefined) {
    throw new Error("Durable browser storage is required before broadcasting");
  }
  storage.setItem(
    pendingTransactionStorageKey(walletConfig),
    JSON.stringify({ version: 1, txHash }),
  );
}

function removeStoredTransactionHash(walletConfig: PendingTransactionAccount): void {
  try {
    browserStorage()?.removeItem(pendingTransactionStorageKey(walletConfig));
  } catch {
    // A failed durable clear remains fail-closed on the next reload.
  }
}
