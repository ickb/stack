import type { ccc } from "@ckb-ccc/ccc";
import { hasTransactionActivity } from "@ickb/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type JSX } from "react";
import type { L1StateType } from "../query/queries.ts";
import {
  errorMessageOf,
  toText,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "../shared/utils.ts";
import { ActionLayout } from "./ActionLayout.tsx";
import {
  actionDisabled,
  actionDone,
  actionLabel,
  actionMessage,
  canPreviewTx,
  currentTxInfo,
  isTxInfoValid,
  shownMaturityText,
  transactionIntentMessage,
  unavailableConversionMessage,
} from "./actionStatus.ts";
import { timeUntilMaturity } from "./actionTime.ts";
import {
  retryConfirmation,
  transact,
  type RefreshedTransactionPreview,
  type RefreshedTransactionState,
} from "./actionTransaction.ts";
import type { Destination } from "./destination.ts";
import type {
  PendingTransactionState,
  PendingTransactionStore,
} from "./pendingTransaction.ts";

const PREVIEW_SETTLE_MS = 300;

export default function Action({
  isCkb2Udt,
  amount,
  amountError,
  destination,
  destinationError,
  refreshPreview,
  freeze,
  formReset,
  walletConfig,
  pendingTransaction,
  pendingStore,
  l1State,
  isStateFetching,
  stateError,
  retryState,
}: Readonly<{
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  amountError: string;
  destination: Destination | undefined;
  destinationError: string;
  refreshPreview: (
    isCkb2Udt: boolean,
    amount: bigint,
    destination: Destination,
  ) => Promise<RefreshedTransactionState>;
  freeze: (value: boolean) => void;
  formReset: () => void;
  walletConfig: WalletConfig;
  pendingTransaction: PendingTransactionState | undefined;
  pendingStore: PendingTransactionStore;
  l1State: L1StateType | undefined;
  isStateFetching: boolean;
  stateError: unknown;
  retryState: () => void;
}>): JSX.Element {
  const [message, setMessage] = useState("");
  // The last attempt's result, kept until the next attempt or an edit of the draft: React's
  // pattern for state that depends on a prop, so a stale "enter a larger amount" never
  // advises on a draft the user has already changed (decisions amendment 52(t)).
  const draft = `${isCkb2Udt ? "C" : "I"}:${amountIdentity(amount, amountError)}:${destinationIdentity(destination)}`;
  const [failure, setFailureFor] = useState({ draft, message: "" });
  if (failure.message !== "" && failure.draft !== draft) {
    setFailureFor({ draft, message: "" });
  }
  const setFailure = (text: string): void => {
    setFailureFor({ draft, message: text });
  };
  const [frozenPreview, setFrozenPreview] = useState<RefreshedTransactionPreview>();
  const mountedRef = useRef(false);
  const attemptRef = useRef<AbortController | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
      attemptRef.current?.abort();
      attemptRef.current = null;
      freeze(false);
    };
  }, [freeze]);
  const freezePreview = (preview: RefreshedTransactionPreview | undefined): void => {
    updateFrozenPreview(preview, setFrozenPreview, freeze, setMessage);
  };

  const isFrozen = frozenPreview !== undefined;
  const isLocked = isPreparing || isFrozen;
  const stateId = previewStateIdentity(frozenPreview, l1State);
  const transactionHash =
    pendingTransaction?.status === "pending" ? pendingTransaction.txHash : undefined;
  const isSubmitting = pendingTransaction?.status === "submitting";
  // The preview completes a real transaction, so it follows the amount only once typing settles.
  const settledAmount = useSettled(amount, PREVIEW_SETTLE_MS);
  const txPreviewQuery = useQuery({
    queryKey: [
      walletConfig.chain,
      walletConfig.address,
      "txInfo",
      stateId,
      isCkb2Udt,
      amountIdentity(settledAmount, amountError),
      destinationIdentity(destination),
    ],
    queryFn: async () => buildPreview(l1State, isCkb2Udt, settledAmount, destination),
    enabled: canPreviewTx(isLocked, l1State, settledAmount, destination !== undefined),
    retry: false,
  });
  if (l1State === undefined) {
    return missingStateActionLayout(stateError, isStateFetching, retryState);
  }

  const txInfo = currentTxInfo(
    isFrozen,
    frozenTransactionInfo(frozenPreview),
    txPreviewQuery.data,
  );
  const isFetching = isStateFetching || txPreviewQuery.isFetching;
  const hasActivity = hasTransactionActivity(txInfo.tx);
  const isValid = isTxInfoValid(txInfo, hasActivity);
  const maturity = timeUntilMaturity(
    txInfo.estimatedMaturity,
    previewTip(frozenPreview, l1State),
  );
  const shownMaturity = shownMaturityText(txInfo, maturity);
  const hasCollectable = previewHasCollectable(frozenPreview, l1State);
  const actionText = transactionActionLabel(
    transactionHash,
    isConfirming,
    amount,
    hasCollectable,
    destination?.moveTo !== undefined,
  );
  const unavailableMessage = unavailableConversionMessage(amount ?? 0n);
  const messageText = actionMessage({
    amount,
    amountError,
    conversionKind: txInfo.conversionKind,
    conversionNotice: txInfo.conversionNotice,
    destinationError,
    failure: failure.message,
    hasActivity,
    hasCollectable,
    hasDestination: destination !== undefined,
    isFrozen,
    isPreparing,
    isStateFetching,
    isTxPreviewFetching: txPreviewQuery.isFetching,
    isValid,
    message,
    moveTo: txInfo.moveTo,
    txError: txInfo.error,
    unavailableMessage,
  });
  const isActionDisabled = transactionActionDisabled({
    hasAmount: amount !== undefined && destination !== undefined,
    isConfirming,
    isPreparing,
    isSubmitting,
    transactionHash,
    isFetching,
    isFrozen,
    isValid,
  });
  const isActionDone = actionDone(isFetching, isPreparing || isConfirming);

  const transactionCallbacks = {
    freezePreview,
    setMessage,
    setFailure,
    setIsPreparing,
    setIsConfirming,
    formReset,
    walletConfig,
    pendingStore,
  };

  return (
    <ActionLayout
      action={actionText}
      disabled={isActionDisabled}
      isDone={isActionDone}
      onAction={() => {
        if (!mountedRef.current) {
          return;
        }
        const currentTransaction = pendingStore.current;
        if (currentTransaction?.status === "submitting") {
          return;
        }
        const cachedTransactionHash =
          currentTransaction?.status === "pending"
            ? currentTransaction.txHash
            : undefined;
        if (cachedTransactionHash !== undefined && isConfirming) {
          attemptRef.current?.abort();
          attemptRef.current = null;
          setIsConfirming(false);
          setMessage("Confirmation wait stopped.");
          return;
        }
        const attempt = new AbortController();
        let operation: Promise<void> | undefined;
        if (cachedTransactionHash === undefined) {
          if (amount !== undefined && destination !== undefined) {
            attemptRef.current = attempt;
            operation = transact({
              ...transactionCallbacks,
              lockIntent: () => {
                freeze(true);
              },
              refreshPreview: async () => refreshPreview(isCkb2Udt, amount, destination),
              signal: attempt.signal,
              unavailableMessage,
            });
          }
        } else {
          attemptRef.current = attempt;
          freeze(true);
          operation = retryConfirmation({
            ...transactionCallbacks,
            signal: attempt.signal,
            txHash: cachedTransactionHash,
          });
        }
        if (operation !== undefined) {
          const releaseAttempt = (): void => {
            if (attemptRef.current === attempt) {
              attemptRef.current = null;
            }
          };
          void operation.then(releaseAttempt, releaseAttempt);
        }
      }}
      message={messageText}
      fee={`${toText(txInfo.fee)} CKB`}
      maturity={shownMaturity}
    />
  );
}

function updateFrozenPreview(
  preview: RefreshedTransactionPreview | undefined,
  setFrozenPreview: (preview: RefreshedTransactionPreview | undefined) => void,
  freeze: (value: boolean) => void,
  setMessage: (message: string) => void,
): void {
  setFrozenPreview(preview);
  freeze(preview !== undefined);
  if (preview !== undefined) {
    const intent = transactionIntentMessage(preview.txInfo, preview.hasCollectable);
    setMessage(
      intent === ""
        ? "Confirm the transaction in your wallet."
        : `${intent} Confirm the transaction in your wallet.`,
    );
  }
}

function stateIdentity(l1State: L1StateType | undefined): string {
  return l1State?.stateId ?? "missing";
}

function previewStateIdentity(
  preview: RefreshedTransactionPreview | undefined,
  l1State: L1StateType | undefined,
): string {
  return preview?.stateId ?? stateIdentity(l1State);
}

function frozenTransactionInfo(preview: RefreshedTransactionPreview | undefined): TxInfo {
  return preview?.txInfo ?? txInfoPadding;
}

function previewTip(
  preview: RefreshedTransactionPreview | undefined,
  l1State: L1StateType,
): bigint {
  return preview?.tipTimestamp ?? l1State.tipTimestamp;
}

function previewHasCollectable(
  preview: RefreshedTransactionPreview | undefined,
  l1State: L1StateType,
): boolean {
  return preview?.hasCollectable ?? l1State.hasCollectable;
}

/** The value as it was `delayMs` ago, unless it has kept changing since. */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return (): void => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

function amountIdentity(amount: bigint | undefined, amountError: string): string {
  return amount?.toString() ?? `invalid:${amountError}`;
}

function destinationIdentity(destination: Destination | undefined): string {
  return destination?.lock.hash() ?? "invalid";
}

async function buildPreview(
  l1State: L1StateType | undefined,
  isCkb2Udt: boolean,
  amount: bigint | undefined,
  destination: Destination | undefined,
): Promise<TxInfo> {
  return l1State !== undefined && amount !== undefined && destination !== undefined
    ? l1State.txBuilder(isCkb2Udt, amount, destination)
    : txInfoPadding;
}

function transactionActionLabel(
  transactionHash: ccc.Hex | undefined,
  isConfirming: boolean,
  amount: bigint | undefined,
  hasCollectable: boolean,
  isMove: boolean,
): string {
  if (transactionHash === undefined) {
    return actionLabel(amount, hasCollectable, isMove);
  }
  return isConfirming ? "stop waiting" : "retry confirmation";
}

function transactionActionDisabled({
  hasAmount,
  isConfirming,
  isPreparing,
  isSubmitting,
  transactionHash,
  isFetching,
  isFrozen,
  isValid,
}: Readonly<{
  hasAmount: boolean;
  isConfirming: boolean;
  isPreparing: boolean;
  isSubmitting: boolean;
  transactionHash: ccc.Hex | undefined;
  isFetching: boolean;
  isFrozen: boolean;
  isValid: boolean;
}>): boolean {
  return transactionHash === undefined
    ? !hasAmount ||
        isPreparing ||
        isSubmitting ||
        isConfirming ||
        actionDisabled(isFetching, isFrozen, isValid)
    : false;
}

function missingStateActionLayout(
  stateError: unknown,
  isStateFetching: boolean,
  retryState: () => void,
): JSX.Element {
  const hasStateError = stateError !== null && stateError !== undefined;
  return (
    <ActionLayout
      action={hasStateError ? "Retry wallet data" : "request conversion"}
      disabled={!hasStateError}
      isDone={!isStateFetching}
      onAction={hasStateError ? retryState : undefined}
      message={
        hasStateError
          ? `⚠️ Unable to load wallet data: ${errorMessageOf(stateError)}`
          : "Loading wallet data..."
      }
      fee="..."
      maturity="..."
    />
  );
}
