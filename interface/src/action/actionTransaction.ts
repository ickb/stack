import type { ccc } from "@ckb-ccc/ccc";
import { ickb } from "@ickb/sdk";
import { l1StateQueryKey, type L1StateType } from "../app/queries.ts";
import { errorMessageOf, type SendableTx, type WalletConfig } from "../shared/utils.ts";
import {
  clearPendingTransaction,
  submitPendingTransaction,
  type PendingTransactionStore,
} from "./pendingTransaction.ts";

export const confirmationWindowMs = 60_000;

const expiredMessage =
  "The withdrawal timing changed while you were signing. Nothing was sent. Review the refreshed preview and sign again.";

/** The fresh state a send was built from, with the transaction it built. */
export type RefreshedTransactionPreview = L1StateType & { readonly txInfo: SendableTx };

export interface TransactionCallbacks {
  readonly freezePreview: (preview: RefreshedTransactionPreview | undefined) => void;
  readonly setMessage: (message: string) => void;
  readonly setFailure: (message: string) => void;
  readonly setIsPreparing: (isPreparing: boolean) => void;
  readonly setIsConfirming: (isConfirming: boolean) => void;
  readonly formReset: () => void;
  readonly walletConfig: WalletConfig;
  readonly pendingStore: PendingTransactionStore;
}

interface TransactParams extends TransactionCallbacks {
  readonly lockIntent: () => void;
  readonly refreshState: () => Promise<L1StateType>;
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly signal: AbortSignal;
  readonly yieldForPreview?: () => Promise<void>;
}

interface RetryConfirmationParams extends TransactionCallbacks {
  readonly txHash: ccc.Hex;
  readonly signal: AbortSignal;
}

/** Sends a valid preview once, then observes it for one finite confirmation window. */
export async function transact({
  lockIntent,
  refreshState,
  isCkb2Udt,
  amount,
  signal,
  yieldForPreview = yieldForPreviewRender,
  ...callbacks
}: TransactParams): Promise<void> {
  let txHash: ccc.Hex | undefined;

  try {
    signal.throwIfAborted();
    lockIntent();
    callbacks.setFailure("");
    callbacks.setIsPreparing(true);
    callbacks.setMessage("Refreshing transaction preview...");
    const state = await abortable(refreshState(), signal);
    signal.throwIfAborted();
    const txInfo = await abortable(state.txBuilder(isCkb2Udt, amount), signal);
    signal.throwIfAborted();
    if (!txInfo.ok) {
      throw new Error(txInfo.error);
    }
    callbacks.freezePreview({ ...state, txInfo });
    await abortable(yieldForPreview(), signal);
    signal.throwIfAborted();
    callbacks.setIsPreparing(false);
    callbacks.setIsConfirming(true);
    const sent = await abortable(
      sendAndStoreTransaction(callbacks.pendingStore, callbacks.walletConfig, txInfo),
      signal,
    );
    signal.throwIfAborted();
    if (!sent.ok && sent.reason === "not-signed") {
      // Declining is the user's choice, not a failure: a calm note, and nothing to reset.
      callbacks.setMessage(`Not signed: ${errorMessageOf(sent.cause)}`);
      releaseTransaction(callbacks);
      return;
    }
    if (!sent.ok && sent.reason === "expired") {
      // Nothing was sent: the preview is released and rebuilds from a fresh state read.
      callbacks.setFailure(expiredMessage);
      callbacks.setMessage("");
      callbacks.walletConfig.resetClient();
      releaseTransaction(callbacks);
      return;
    }
    // A lost answer does not undo a send: the node may hold the transaction, so the
    // same window watches its hash (end-game consultation 2026-09-19). A resend could
    // not tell what became of the first copy; only the status read can.
    txHash = sent.txHash;
    callbacks.setMessage(
      sent.ok
        ? `Transaction ${txHash} sent. Waiting for network confirmation...`
        : `Transaction ${txHash} sent, but the node's answer was lost. Checking confirmation...`,
    );
    await confirm(callbacks, txHash, signal);
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    callbacks.setFailure(transactionFailureMessage(error, txHash));
    callbacks.setMessage("");
    callbacks.walletConfig.resetClient();
    if (txHash === undefined) {
      releaseTransaction(callbacks);
    }
  } finally {
    if (!signal.aborted) {
      callbacks.setIsPreparing(false);
      callbacks.setIsConfirming(false);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/promise-function-async -- Preserve the shared account submission promise through the broadcast boundary.
function sendAndStoreTransaction(
  pendingStore: PendingTransactionStore,
  walletConfig: WalletConfig,
  txInfo: SendableTx,
): Promise<ickb.SignAndSendTransactionResult> {
  return submitPendingTransaction(
    pendingStore,
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Preserve the SDK broadcast promise unchanged.
    () => ickb.signAndSendTransaction(walletConfig.signer, txInfo),
  );
}

async function yieldForPreviewRender(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Rechecks an already-broadcast hash without signing or broadcasting again. */
export async function retryConfirmation({
  txHash,
  signal,
  ...callbacks
}: RetryConfirmationParams): Promise<void> {
  try {
    signal.throwIfAborted();
    callbacks.setFailure("");
    callbacks.setIsConfirming(true);
    callbacks.setMessage(
      `Transaction ${txHash} sent. Waiting for network confirmation...`,
    );
    await confirm(callbacks, txHash, signal);
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    callbacks.setFailure(transactionFailureMessage(error, txHash));
    callbacks.setMessage("");
    callbacks.walletConfig.resetClient();
  } finally {
    if (!signal.aborted) {
      callbacks.setIsConfirming(false);
    }
  }
}

/** Observes an already-broadcast hash for exactly one finite window. */
export async function waitForConfirmation(
  client: ccc.Client,
  txHash: ccc.Hex,
  signal: AbortSignal,
): Promise<ickb.WaitTransactionResult> {
  return ickb.waitTransaction(client, txHash, { timeout: confirmationWindowMs, signal });
}

/**
 * Waits one window on a sent hash and settles the session by its outcome: confirmed
 * completes it, a rejection releases it, a timeout keeps the hash for a retry.
 */
async function confirm(
  callbacks: TransactionCallbacks,
  txHash: ccc.Hex,
  signal: AbortSignal,
): Promise<void> {
  const done = await waitForConfirmation(
    callbacks.walletConfig.signer.client,
    txHash,
    signal,
  );
  signal.throwIfAborted();
  if (done.ok) {
    await completeConfirmedTransaction(callbacks, signal);
    return;
  }
  callbacks.setMessage("");
  callbacks.walletConfig.resetClient();
  if (done.reason === "rejected") {
    callbacks.setFailure(
      `Transaction rejected: ${done.detail ?? "the node gave no reason"}. Hash: ${txHash}`,
    );
    // A known rejection is final; the next action rebuilds from committed cells.
    clearPendingTransaction(callbacks.pendingStore);
    releaseTransaction(callbacks);
    return;
  }
  const seconds = String(confirmationWindowMs / 1000);
  callbacks.setFailure(
    `Transaction ${txHash} is still unconfirmed after ${seconds}s. It may still confirm; check again.`,
  );
}

function releaseTransaction({ freezePreview }: TransactionCallbacks): void {
  freezePreview(undefined);
}

async function completeConfirmedTransaction(
  {
    freezePreview,
    formReset,
    setMessage,
    walletConfig,
    pendingStore,
  }: TransactionCallbacks,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  setMessage("Transaction confirmed.");
  await abortable(
    walletConfig.queryClient.invalidateQueries({
      queryKey: l1StateQueryKey(walletConfig),
      exact: true,
    }),
    signal,
  );
  signal.throwIfAborted();
  formReset();
  clearPendingTransaction(pendingStore);
  freezePreview(undefined);
  setMessage("");
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<T>();
  const onAbort = (): void => {
    aborted.reject(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let result: T;
  try {
    result = await Promise.race([promise, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return result;
}

function transactionFailureMessage(error: unknown, txHash: ccc.Hex | undefined): string {
  const message = errorMessageOf(error);
  return txHash === undefined ? message : `${message}. Hash: ${txHash}`;
}
