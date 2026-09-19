import { hasTransactionActivity } from "@ickb/sdk";
import { skipToken, useQuery } from "@tanstack/react-query";
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
  actionLabel,
  actionMessage,
  confirmPreviewMessage,
  isTxInfoValid,
  shownMaturityText,
  timeUntilMaturity,
  unavailableConversionMessage,
} from "./actionStatus.ts";
import {
  retryConfirmation,
  transact,
  type RefreshedTransactionPreview,
  type RefreshedTransactionState,
  type TransactionCallbacks,
} from "./actionTransaction.ts";
import type { Destination } from "./destination.ts";
import type {
  PendingTransactionState,
  PendingTransactionStore,
} from "./pendingTransaction.ts";

const PREVIEW_SETTLE_MS = 300;

type ActionProps = Readonly<{
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
}>;

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
}: ActionProps): JSX.Element {
  const [message, setMessage] = useState("");
  // The last attempt's result, kept until the next attempt or an edit of the draft: React's
  // pattern for state that depends on a prop, so a stale "enter a larger amount" never
  // advises on a draft the user has already changed (decisions amendment 52(t)).
  const draft = `${String(isCkb2Udt)}:${amountIdentity(amount, amountError)}:${destinationIdentity(destination)}`;
  const [failure, setFailureFor] = useState({ draft, message: "" });
  if (failure.message !== "" && failure.draft !== draft) {
    setFailureFor({ draft, message: "" });
  }
  const setFailure = (text: string): void => {
    setFailureFor({ draft, message: text });
  };
  const [frozenPreview, setFrozenPreview] = useState<RefreshedTransactionPreview>();
  const attempt = useAttempt(freeze);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const freezePreview = (preview: RefreshedTransactionPreview | undefined): void => {
    setFrozenPreview(preview);
    freeze(preview !== undefined);
    setMessage(confirmPreviewMessage(preview));
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
      "txInfo",
      sampled?.stateId ?? "missing",
      isCkb2Udt,
      amountIdentity(settledAmount, amountError),
      destinationIdentity(destination),
    ],
    queryFn: previewBuilder(l1State, isCkb2Udt, settledAmount, destination) ?? skipToken,
    enabled: !isLocked,
    retry: false,
  });
  if (l1State === undefined) {
    return missingStateActionLayout(stateError, isStateFetching, retryState);
  }

  const txInfo = frozenPreview?.txInfo ?? txPreviewQuery.data ?? txInfoPadding;
  const isFetching = isStateFetching || txPreviewQuery.isFetching;
  const isValid = isTxInfoValid(txInfo, hasTransactionActivity(txInfo.tx));
  const maturity = timeUntilMaturity(
    txInfo.estimatedMaturity,
    frozenPreview?.tipTimestamp ?? l1State.system.tip.timestamp,
  );
  const { hasCollectable } = sampled ?? l1State;
  const actionText =
    transactionHash === undefined
      ? actionLabel(amount, hasCollectable, destination?.moveTo !== undefined)
      : confirmationLabel(isConfirming);
  const unavailableMessage = unavailableConversionMessage(amount ?? 0n);
  const messageText = actionMessage(txInfo, {
    amount,
    amountError,
    destinationError,
    failure: failure.message,
    hasCollectable,
    hasDestination: destination !== undefined,
    isFrozen,
    isPreparing,
    isStateFetching,
    isTxPreviewFetching: txPreviewQuery.isFetching,
    message,
    unavailableMessage,
  });
  // A pending hash is always actionable (retry or stop); a fresh request needs a valid,
  // settled preview and no attempt under way.
  const isActionDisabled =
    transactionHash === undefined &&
    (amount === undefined ||
      destination === undefined ||
      isPreparing ||
      isSubmitting ||
      isConfirming ||
      isFetching ||
      isFrozen ||
      !isValid);
  const isActionDone = !isFetching && !(isPreparing || isConfirming);

  return (
    <ActionLayout
      action={actionText}
      disabled={isActionDisabled}
      isDone={isActionDone}
      onAction={() => {
        startAttempt({
          attempt,
          isConfirming,
          isCkb2Udt,
          amount,
          destination,
          refreshPreview,
          freeze,
          unavailableMessage,
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
      // Maturity and fee describe a transaction; before a valid preview there is none.
      fee={isValid ? `${toText(txInfo.fee)} CKB` : "..."}
      maturity={isValid ? shownMaturityText(txInfo, maturity) : "..."}
    />
  );
}

/** The one attempt the section may own; unmounting aborts it and releases the form. */
interface AttemptOwner {
  readonly abort: () => void;
  readonly run: (start: (signal: AbortSignal) => Promise<void>) => void;
}

function useAttempt(freeze: (value: boolean) => void): AttemptOwner {
  const current = useRef<AbortController | null>(null);
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return (): void => {
      isMounted.current = false;
      current.current?.abort();
      current.current = null;
      freeze(false);
    };
  }, [freeze]);
  return {
    abort: (): void => {
      current.current?.abort();
      current.current = null;
    },
    run: (start): void => {
      if (!isMounted.current) {
        return;
      }
      const controller = new AbortController();
      current.current = controller;
      const release = (): void => {
        if (current.current === controller) {
          current.current = null;
        }
      };
      void start(controller.signal).then(release, release);
    },
  };
}

/**
 * Starts the one attempt a click may own: a fresh request, a retry of the pending hash's
 * confirmation, or, while a retry waits, a stop. A submission under way owns the click.
 */
function startAttempt({
  attempt,
  isConfirming,
  isCkb2Udt,
  amount,
  destination,
  refreshPreview,
  freeze,
  unavailableMessage,
  callbacks,
}: Readonly<{
  attempt: AttemptOwner;
  isConfirming: boolean;
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  destination: Destination | undefined;
  refreshPreview: ActionProps["refreshPreview"];
  freeze: (value: boolean) => void;
  unavailableMessage: string;
  callbacks: TransactionCallbacks;
}>): void {
  const current = callbacks.pendingStore.current;
  if (current?.status === "submitting") {
    return;
  }
  if (current?.status === "pending" && isConfirming) {
    attempt.abort();
    callbacks.setIsConfirming(false);
    callbacks.setMessage("Confirmation wait stopped.");
    return;
  }
  if (current !== undefined) {
    attempt.run(async (signal): Promise<void> => {
      freeze(true);
      await retryConfirmation({ ...callbacks, signal, txHash: current.txHash });
    });
  } else if (amount !== undefined && destination !== undefined) {
    attempt.run(async (signal): Promise<void> =>
      transact({
        ...callbacks,
        lockIntent: () => {
          freeze(true);
        },
        refreshPreview: async (): Promise<RefreshedTransactionState> =>
          refreshPreview(isCkb2Udt, amount, destination),
        signal,
        unavailableMessage,
      }),
    );
  }
}

/** The preview builder for the settled draft; the query parks while any part is missing. */
function previewBuilder(
  l1State: L1StateType | undefined,
  isCkb2Udt: boolean,
  amount: bigint | undefined,
  destination: Destination | undefined,
): (() => Promise<TxInfo>) | undefined {
  if (l1State === undefined || amount === undefined || destination === undefined) {
    return undefined;
  }
  return async () => l1State.txBuilder(isCkb2Udt, amount, destination);
}

function confirmationLabel(isConfirming: boolean): string {
  return isConfirming ? "stop waiting" : "retry confirmation";
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
