import { ccc } from "@ckb-ccc/ccc";
import {
  TransactionBroadcastError,
  TransactionWaitError,
  signAndSendTransaction,
  waitTransaction,
} from "@ickb/sdk";
import { l1StateQueryKey } from "../query/l1StateQueryKey.ts";
import {
  errorMessageOf,
  hasTransactionActivity,
  type TxInfo,
  type WalletConfig,
} from "../shared/utils.ts";
import {
  clearPendingTransaction,
  submitPendingTransaction,
  type PendingTransactionStore,
} from "./pendingTransaction.ts";

export const confirmationWindowMs = 60_000;

interface RefreshedTransactionStateMetadata {
  readonly stateId: string;
  readonly tipTimestamp: bigint;
  readonly hasCollectable: boolean;
}

export interface RefreshedTransactionState extends RefreshedTransactionStateMetadata {
  readonly build: () => Promise<TxInfo>;
}

export interface RefreshedTransactionPreview extends RefreshedTransactionStateMetadata {
  readonly txInfo: TxInfo;
}

interface TransactionCallbacks {
  readonly freezePreview: (preview: RefreshedTransactionPreview | undefined) => void;
  readonly setMessage: (message: string) => void;
  readonly setFailure: (message: string, stateId?: string) => void;
  readonly setIsPreparing: (isPreparing: boolean) => void;
  readonly setIsConfirming: (isConfirming: boolean) => void;
  readonly formReset: () => void;
  readonly walletConfig: WalletConfig;
  readonly pendingStore: PendingTransactionStore;
}

interface TransactParams extends TransactionCallbacks {
  readonly lockIntent: () => void;
  readonly refreshPreview: () => Promise<RefreshedTransactionState>;
  readonly unavailableMessage: string;
  readonly signal: AbortSignal;
  readonly yieldForPreview?: () => Promise<void>;
}

interface RetryConfirmationParams extends TransactionCallbacks {
  readonly txHash: ccc.Hex;
  readonly signal: AbortSignal;
}

class AttemptAbortedError extends Error {
  constructor() {
    super("Transaction attempt owner unmounted");
    this.name = "AttemptAbortedError";
  }
}

/** Sends a valid preview once, then observes it for one finite confirmation window. */
export async function transact({
  lockIntent,
  refreshPreview,
  unavailableMessage,
  signal,
  yieldForPreview = yieldForPreviewRender,
  ...callbacks
}: TransactParams): Promise<void> {
  let txHash: ccc.Hex | undefined;
  let stateId: string | undefined;

  try {
    assertCurrent(signal);
    lockIntent();
    callbacks.setFailure("");
    callbacks.setIsPreparing(true);
    callbacks.setMessage("Refreshing transaction preview...");
    const { build, ...previewState } = await abortable(refreshPreview(), signal);
    assertCurrent(signal);
    stateId = previewState.stateId;
    const txInfo = await abortable(build(), signal);
    assertCurrent(signal);
    callbacks.freezePreview({ txInfo, ...previewState });
    assertBroadcastable(txInfo, unavailableMessage);
    await abortable(yieldForPreview(), signal);
    assertCurrent(signal);
    callbacks.setIsPreparing(false);
    callbacks.setIsConfirming(true);
    const sentHash = await abortable(
      sendAndStoreTransaction(callbacks.pendingStore, callbacks.walletConfig, txInfo),
      signal,
    );
    assertCurrent(signal);
    txHash = sentHash;
    callbacks.setMessage(
      `Transaction ${sentHash} sent. Waiting for network confirmation...`,
    );
    await waitForConfirmation(callbacks.walletConfig.signer.client, sentHash, signal);
    assertCurrent(signal);
    await completeConfirmedTransaction(callbacks, signal);
  } catch (error) {
    if (error instanceof TransactionBroadcastError) {
      txHash = error.txHash;
    }
    if (signal.aborted || error instanceof AttemptAbortedError) {
      return;
    }
    callbacks.setFailure(transactionFailureMessage(error, txHash), stateId);
    callbacks.setMessage("");
    if (error instanceof TransactionWaitError) {
      // A known rejection is final; the next action rebuilds from committed cells.
      clearPendingTransaction(callbacks.pendingStore);
      releaseTransaction(callbacks);
    } else if (txHash === undefined) {
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
  txInfo: TxInfo,
): Promise<ccc.Hex> {
  return submitPendingTransaction(
    pendingStore,
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Preserve the SDK broadcast promise unchanged.
    (recordTxHash) =>
      signAndSendTransaction(walletConfig.signer, txInfo.tx, recordTxHash),
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
    assertCurrent(signal);
    callbacks.setFailure("");
    callbacks.setIsConfirming(true);
    callbacks.setMessage(
      `Transaction ${txHash} sent. Waiting for network confirmation...`,
    );
    await waitForConfirmation(callbacks.walletConfig.signer.client, txHash, signal);
    assertCurrent(signal);
    await completeConfirmedTransaction(callbacks, signal);
  } catch (error) {
    if (signal.aborted || error instanceof AttemptAbortedError) {
      return;
    }
    callbacks.setFailure(transactionFailureMessage(error, txHash));
    callbacks.setMessage("");
    if (error instanceof TransactionWaitError) {
      clearPendingTransaction(callbacks.pendingStore);
      releaseTransaction(callbacks);
    }
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
): Promise<void> {
  await waitTransaction(client, txHash, { timeout: confirmationWindowMs, signal });
  assertCurrent(signal);
}

function assertBroadcastable(txInfo: TxInfo, unavailableMessage: string): void {
  if (txInfo.error !== "") {
    throw new Error(txInfo.error);
  }
  if (!hasTransactionActivity(txInfo.tx)) {
    throw new Error(unavailableMessage);
  }
  if (txInfo.fee <= 0n) {
    throw new Error("Transaction fee is missing or invalid");
  }
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
  assertCurrent(signal);
  setMessage("Transaction confirmed.");
  await abortable(
    walletConfig.queryClient.invalidateQueries({
      queryKey: l1StateQueryKey(walletConfig),
      exact: true,
    }),
    signal,
  );
  assertCurrent(signal);
  formReset();
  clearPendingTransaction(pendingStore);
  freezePreview(undefined);
  setMessage("");
}

function assertCurrent(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AttemptAbortedError();
  }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  assertCurrent(signal);
  const aborted = Promise.withResolvers<T>();
  const onAbort = (): void => {
    aborted.reject(new AttemptAbortedError());
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

function isWaitWindowTimeout(error: unknown): boolean {
  return (
    error instanceof ccc.ErrorClientWaitTransactionTimeout ||
    (error instanceof Error && error.name === "ErrorClientWaitTransactionTimeout")
  );
}

function transactionFailureMessage(error: unknown, txHash: ccc.Hex | undefined): string {
  if (error instanceof TransactionBroadcastError) {
    return error.message;
  }
  if (error instanceof TransactionWaitError) {
    const reason = error.reason ?? error.status;
    return `Transaction rejected: ${reason}. Hash: ${error.txHash}`;
  }
  if (isWaitWindowTimeout(error) && txHash !== undefined) {
    const seconds = String(confirmationWindowMs / 1000);
    return `Transaction ${txHash} is still unconfirmed after ${seconds}s. It may still confirm; check again.`;
  }

  const message = errorMessageOf(error);
  return txHash === undefined ? message : `${message}. Hash: ${txHash}`;
}
