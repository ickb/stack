import type { L1StateType } from "../query/queries.ts";
import { toText, txInfoPadding, type TxInfo } from "../shared/utils.ts";
import { noCollectionMessage, noRequestMessage } from "./transaction.ts";

interface ActionMessageParams {
  readonly amount: bigint | undefined;
  readonly amountError: string;
  readonly conversionKind: TxInfo["conversionKind"];
  readonly conversionNotice: TxInfo["conversionNotice"];
  readonly failure: string;
  readonly hasActivity: boolean;
  readonly hasCollectable: boolean;
  readonly isFrozen: boolean;
  readonly isPreparing: boolean;
  readonly isStateFetching: boolean;
  readonly isTxPreviewFetching: boolean;
  readonly isValid: boolean;
  readonly message: string;
  readonly txError: string;
  readonly unavailableMessage: string;
}

/** Resolves the status message shown beside the conversion action button. */
export function actionMessage({
  amount,
  amountError,
  conversionKind,
  conversionNotice,
  failure,
  hasActivity,
  hasCollectable,
  isFrozen,
  isPreparing,
  isStateFetching,
  isTxPreviewFetching,
  isValid,
  message,
  txError,
  unavailableMessage,
}: Readonly<ActionMessageParams>): string {
  if (failure !== "") {
    return failureMessage(failure);
  }

  if (isFrozen) {
    return message;
  }

  if (isPreparing) {
    return message;
  }

  if (amount === undefined) {
    return amountError === ""
      ? "Finish entering the amount."
      : failureMessage(amountError);
  }

  const pendingMessage = actionPendingMessage(
    amount,
    isStateFetching,
    isTxPreviewFetching,
  );
  if (pendingMessage !== "") {
    return pendingMessage;
  }

  return previewMessage({
    conversionKind,
    conversionNotice,
    hasActivity,
    hasCollectable,
    isValid,
    txError,
    unavailableMessage,
  });
}

function previewMessage({
  conversionKind,
  conversionNotice,
  hasActivity,
  hasCollectable,
  isValid,
  txError,
  unavailableMessage,
}: Readonly<{
  conversionKind: TxInfo["conversionKind"];
  conversionNotice: TxInfo["conversionNotice"];
  hasActivity: boolean;
  hasCollectable: boolean;
  isValid: boolean;
  txError: string;
  unavailableMessage: string;
}>): string {
  if (txError !== "") {
    // The preview lags the typed amount by the settle delay, so an availability error is
    // worded for the amount on screen, not the one the preview was built for.
    return isAvailabilityMessage(txError)
      ? `${unavailableMessage}.`
      : failureMessage(txError);
  }

  if (!hasActivity) {
    return `${unavailableMessage}.`;
  }

  if (!isValid) {
    return "Transaction preview is not ready.";
  }

  return transactionIntentMessage({ conversionKind, conversionNotice }, hasCollectable);
}

export function transactionIntentMessage(
  txInfo: Pick<TxInfo, "conversionKind" | "conversionNotice">,
  hasCollectable: boolean,
): string {
  return [
    txInfo.conversionKind === undefined
      ? ""
      : conversionIntentText(txInfo.conversionKind),
    txInfo.conversionNotice === undefined
      ? ""
      : conversionNoticeText(txInfo.conversionNotice),
    txInfo.conversionKind === "collect-only" ? "" : collectableNotice(hasCollectable),
  ]
    .filter((text) => text !== "")
    .join(" ");
}

function failureMessage(failure: string): string {
  return `⚠️ ${failure}`;
}

function isAvailabilityMessage(message: string): boolean {
  return message === noCollectionMessage || message === noRequestMessage;
}

function actionPendingMessage(
  amount: bigint,
  isStateFetching: boolean,
  isTxPreviewFetching: boolean,
): string {
  if (isStateFetching) {
    return "Refreshing wallet data...";
  }

  if (isTxPreviewFetching) {
    return checkingMessage(amount);
  }

  return "";
}

function conversionNoticeText(notice: NonNullable<TxInfo["conversionNotice"]>): string {
  const inputIckb = toText(notice.inputIckb);
  const outputCkb = toText(notice.outputCkb);
  const incentiveCkb = toText(notice.incentiveCkb);
  return notice.kind === "maturity-unavailable"
    ? `This request converts ${inputIckb} iCKB to about ${outputCkb} CKB. Timing is not available yet.`
    : `This small request converts ${inputIckb} iCKB to about ${outputCkb} CKB with a ${incentiveCkb} CKB matcher incentive.`;
}

function collectableNotice(hasCollectable: boolean): string {
  if (hasCollectable) {
    return "Also collects converted funds.";
  }

  return "";
}

export function conversionIntentText(
  kind: NonNullable<TxInfo["conversionKind"]>,
): string {
  const intent: Record<NonNullable<TxInfo["conversionKind"]>, string> = {
    "collect-only": "Collect converted funds.",
    direct: "Direct conversion.",
    order: "Create a standing order.",
    "direct-plus-order": "Direct conversion plus a standing order for the remainder.",
  };
  return `Intent: ${intent[kind]}`;
}

function checkingMessage(amount: bigint): string {
  if (amount > 0n) {
    return "Checking conversion request...";
  }

  return "Checking converted funds...";
}

export function canPreviewTx(
  isFrozen: boolean,
  l1State: L1StateType | undefined,
  amount: bigint | undefined,
): boolean {
  return !isFrozen && l1State !== undefined && amount !== undefined;
}

export function currentTxInfo(
  isFrozen: boolean,
  frozenTxInfo: TxInfo,
  previewTxInfo: TxInfo | undefined,
): TxInfo {
  if (isFrozen) {
    return frozenTxInfo;
  }

  return previewTxInfo ?? txInfoPadding;
}

/** Returns true only for a broadcastable preview with real transaction activity. */
export function isTxInfoValid(txInfo: TxInfo, hasActivity: boolean): boolean {
  return hasActivity && txInfo.fee > 0n && txInfo.error === "";
}

export function shownMaturityText(txInfo: TxInfo, maturity: string): string {
  if (txInfo.conversionNotice?.maturityEstimateUnavailable === true) {
    return "Waiting for CKB liquidity";
  }

  return maturity;
}

export function actionLabel(amount: bigint | undefined, hasCollectable: boolean): string {
  if (amount === 0n && hasCollectable) {
    return "collect converted funds";
  }

  return "request conversion";
}

export function unavailableConversionMessage(amount: bigint): string {
  if (amount > 0n) {
    return noRequestMessage;
  }

  return noCollectionMessage;
}

export function actionDisabled(
  isFetching: boolean,
  isFrozen: boolean,
  isValid: boolean,
): boolean {
  return isFetching || isFrozen || !isValid;
}

export function actionDone(isFetching: boolean, isConfirming: boolean): boolean {
  return !isFetching && !isConfirming;
}
