import { ccc } from "@ckb-ccc/ccc";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type JSX } from "react";
import type { L1StateType } from "../app/queries.ts";
import { errorMessageOf, type TxInfo, type WalletConfig } from "../shared/utils.ts";
import { ActionLayout } from "./ActionLayout.tsx";
import {
  actionLabel,
  actionMessage,
  timeUntilMaturity,
  unavailableConversionMessage,
} from "./actionStatus.ts";
import type { AttemptState } from "./actionTransaction.ts";

const PREVIEW_SETTLE_MS = 300;

type ActionProps = Readonly<{
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  amountError: string;
  walletConfig: WalletConfig;
  /** The wallet session's attempt, which outlives this view. */
  attempt: AttemptState;
  /** Starts an attempt in the wallet session. */
  onAction: () => void;
  l1State: L1StateType | undefined;
  isStateFetching: boolean;
  stateError: Error | null;
  retryState: () => void;
}>;

export default function Action({
  isCkb2Udt,
  amount,
  amountError,
  walletConfig,
  attempt,
  onAction,
  l1State,
  isStateFetching,
  stateError,
  retryState,
}: ActionProps): JSX.Element {
  const { phase, message, failure, frozenPreview } = attempt;
  const isPreparing = phase === "preparing";
  const isConfirming = phase === "confirming";
  const isFrozen = frozenPreview !== undefined;
  const isLocked = isPreparing || isFrozen;
  // While a preview is frozen its own sampled state stands in for the live one.
  const sampled = frozenPreview ?? l1State;
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
  const actionText = isConfirming ? "confirming..." : actionLabel(amount, hasCollectable);
  const unavailableMessage = unavailableConversionMessage(amount ?? 0n);
  const messageText = actionMessage(preview, {
    amount,
    amountError,
    failure,
    hasCollectable,
    hasConverting,
    isFrozen,
    isPreparing,
    isStateFetching,
    isTxPreviewFetching: txPreviewQuery.isFetching,
    message,
    unavailableMessage,
  });
  // A request needs a valid, settled preview and no attempt under way.
  const isActionDisabled =
    isConfirming ||
    amount === undefined ||
    isPreparing ||
    isFetching ||
    isFrozen ||
    !isValid;
  const isActionDone = !isFetching && !(isPreparing || isConfirming);

  return (
    <ActionLayout
      action={actionText}
      disabled={isActionDisabled}
      isDone={isActionDone}
      onAction={onAction}
      message={messageText}
      fee={isValid ? `${ccc.fixedPointToString(preview.plannedFee)} CKB` : "..."}
      maturity={maturity}
    />
  );
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
