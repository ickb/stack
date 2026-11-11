import { ccc } from "@ckb-ccc/ccc";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type JSX } from "react";
import type { L1StateType } from "../app/queries.ts";
import { errorMessageOf, type TxInfo, type WalletConfig } from "../shared/utils.ts";
import { ActionLayout } from "./ActionLayout.tsx";
import {
  actionLabel,
  actionMessage,
  confirmPreviewMessage,
  timeUntilMaturity,
  unavailableConversionMessage,
} from "./actionStatus.ts";
import {
  retryConfirmation,
  transact,
  type RefreshedTransactionPreview,
  type TransactionCallbacks,
} from "./actionTransaction.ts";
import type {
  PendingTransactionState,
  PendingTransactionStore,
} from "./pendingTransaction.ts";

const PREVIEW_SETTLE_MS = 300;

type ActionProps = Readonly<{
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  amountError: string;
  /** Refetches the wallet's state for a send, throwing when it cannot. */
  refreshState: () => Promise<L1StateType>;
  freeze: (value: boolean) => void;
  formReset: () => void;
  walletConfig: WalletConfig;
  pendingTransaction: PendingTransactionState | undefined;
  pendingStore: PendingTransactionStore;
  l1State: L1StateType | undefined;
  isStateFetching: boolean;
  stateError: Error | null;
  retryState: () => void;
}>;

export default function Action({
  isCkb2Udt,
  amount,
  amountError,
  refreshState,
  freeze,
  formReset,
  walletConfig,
  pendingTransaction,
  pendingStore,
  l1State,
  isStateFetching,
  stateError,
  retryState,
}: ActionProps): JSX.Element {
  // Shown only while an attempt prepares or holds a preview, and each attempt sets it first.
  // Stryker disable next-line StringLiteral: see above.
  const [message, setMessage] = useState("");
  // The last attempt's result, kept until the next attempt or an edit of the draft: React's
  // pattern for state that depends on a prop, so a stale "enter a larger amount" never
  // advises on a draft the user has already changed.
  const draft = `${String(isCkb2Udt)}:${String(amount)}`;
  // Any first value is replaced, on the first render, by this draft's empty failure.
  // Stryker disable next-line ObjectLiteral: see above.
  const [failure, setFailureFor] = useState({ draft, message: "" });
  if (failure.draft !== draft) {
    setFailureFor({ draft, message: "" });
  }
  const setFailure = (text: string): void => {
    setFailureFor({ draft, message: text });
  };
  const [frozenPreview, setFrozenPreview] = useState<RefreshedTransactionPreview>();
  const runAttempt = useAttempt(freeze);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const freezePreview = (preview: RefreshedTransactionPreview | undefined): void => {
    setFrozenPreview(preview);
    freeze(preview !== undefined);
    if (preview !== undefined) {
      setMessage(confirmPreviewMessage(preview));
    }
  };

  const isFrozen = frozenPreview !== undefined;
  const isLocked = isPreparing || isFrozen;
  // While a preview is frozen its own sampled state stands in for the live one.
  const sampled = frozenPreview ?? l1State;
  const transactionHash =
    pendingTransaction?.status === "pending" ? pendingTransaction.txHash : undefined;
  const isSubmitting = pendingTransaction?.status === "submitting";
  // The preview completes a real transaction, so it follows the amount only once typing settles.
  const settledAmount = useSettled(amount, PREVIEW_SETTLE_MS);
  const txPreviewQuery = useQuery({
    queryKey: [
      walletConfig.chain,
      walletConfig.address,
      // Any name apart from the other queries' keys works.
      // Stryker disable next-line StringLiteral: see above.
      "txInfo",
      sampled?.stateId,
      isCkb2Udt,
      // The query's key hashing has no bigint.
      String(settledAmount),
    ],
    queryFn: previewBuilder(l1State, isCkb2Udt, settledAmount) ?? skipToken,
    enabled: !isLocked,
    retry: false,
  });
  if (l1State === undefined) {
    return missingStateActionLayout(stateError, isStateFetching, retryState);
  }

  const preview = frozenPreview?.txInfo ?? txPreviewQuery.data;
  const isFetching = isStateFetching || txPreviewQuery.isFetching;
  const isValid = preview?.ok === true;
  const state = sampled ?? l1State;
  const { hasCollectable, hasConverting } = state;
  const maturity = maturityLabel(preview, state);
  const actionText =
    transactionHash === undefined
      ? actionLabel(amount, hasCollectable)
      : confirmationLabel(isConfirming);
  const unavailableMessage = unavailableConversionMessage(amount ?? 0n);
  const messageText = actionMessage(preview, {
    amount,
    amountError,
    failure: failure.message,
    hasCollectable,
    hasConverting,
    isFrozen,
    isPreparing,
    isStateFetching,
    isTxPreviewFetching: txPreviewQuery.isFetching,
    message,
    unavailableMessage,
  });
  // A pending hash is actionable once its watch closes (retry); a fresh request needs a
  // valid, settled preview and no attempt under way.
  const isActionDisabled =
    isConfirming ||
    (transactionHash === undefined &&
      (amount === undefined ||
        isPreparing ||
        isSubmitting ||
        isFetching ||
        isFrozen ||
        !isValid));
  const isActionDone = !isFetching && !(isPreparing || isConfirming);

  return (
    <ActionLayout
      action={actionText}
      disabled={isActionDisabled}
      isDone={isActionDone}
      onAction={() => {
        startAttempt({
          runAttempt,
          isCkb2Udt,
          amount,
          refreshState,
          freeze,
          callbacks: {
            freezePreview,
            setMessage,
            setFailure,
            setIsPreparing,
            setIsConfirming,
            formReset,
            walletConfig,
            pendingStore,
          },
        });
      }}
      message={messageText}
      fee={isValid ? `${ccc.fixedPointToString(preview.plannedFee)} CKB` : "..."}
      maturity={maturity}
    />
  );
}

type RunAttempt = (start: (signal: AbortSignal) => Promise<void>) => void;

/** Runs attempts under the mount's one controller; unmounting aborts and releases the form. */
function useAttempt(freeze: (value: boolean) => void): RunAttempt {
  // Replaced on mount; a click can only come after it.
  const controller = useRef(new AbortController());
  useEffect(
    () => {
      const mounted = new AbortController();
      controller.current = mounted;
      return (): void => {
        mounted.abort();
        freeze(false);
      };
    },
    // freeze is the app's state setter, the same for the whole mount.
    // Stryker disable next-line ArrayDeclaration: see above.
    [freeze],
  );
  return (start): void => {
    const { signal } = controller.current;
    if (signal.aborted) {
      return;
    }
    void start(signal);
  };
}

/**
 * Starts the one attempt a click may own: a fresh request or a retry of the pending hash's
 * confirmation. A submission under way owns the click.
 */
function startAttempt({
  runAttempt,
  isCkb2Udt,
  amount,
  refreshState,
  freeze,
  callbacks,
}: Readonly<{
  runAttempt: RunAttempt;
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  refreshState: ActionProps["refreshState"];
  freeze: (value: boolean) => void;
  callbacks: TransactionCallbacks;
}>): void {
  const current = callbacks.pendingStore.current;
  if (current?.status === "submitting") {
    return;
  }
  if (current !== undefined) {
    runAttempt(async (signal): Promise<void> => {
      freeze(true);
      await retryConfirmation({ ...callbacks, signal, txHash: current.txHash });
    });
  } else if (amount !== undefined) {
    runAttempt(async (signal): Promise<void> =>
      transact({
        ...callbacks,
        lockIntent: () => {
          freeze(true);
        },
        refreshState,
        isCkb2Udt,
        amount,
        signal,
      }),
    );
  }
}

/**
 * The "Ready:" value: when everything is collectable, the previewed conversion and what is
 * already converting alike, so the latest of the two dates. The state dates what is
 * converting when the preview has nothing to sign, so it shows whenever something is.
 */
function maturityLabel(preview: TxInfo | undefined, state: L1StateType): string {
  const tip = state.tip.timestamp;
  if (preview?.ok === true) {
    return timeUntilMaturity(
      ccc.numMax(preview.estimatedMaturity, state.estimatedMaturity),
      tip,
    );
  }
  return preview !== undefined && state.hasConverting
    ? timeUntilMaturity(state.estimatedMaturity, tip)
    : "...";
}

/** The preview builder for the settled draft; the query parks while any part is missing. */
function previewBuilder(
  l1State: L1StateType | undefined,
  isCkb2Udt: boolean,
  amount: bigint | undefined,
): (() => Promise<TxInfo>) | undefined {
  if (l1State === undefined || amount === undefined) {
    return undefined;
  }
  return async () => l1State.txBuilder(isCkb2Udt, amount);
}

function confirmationLabel(isConfirming: boolean): string {
  return isConfirming ? "confirming..." : "retry confirmation";
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

function missingStateActionLayout(
  stateError: Error | null,
  isStateFetching: boolean,
  retryState: () => void,
): JSX.Element {
  const hasStateError = stateError !== null;
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
