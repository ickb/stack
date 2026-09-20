import { hasTransactionActivity } from "@ickb/sdk";
import { toText, type TxInfo } from "../shared/utils.ts";
import { noCollectionMessage, noRequestMessage } from "./transaction.ts";

/** What the action section knows beside the preview itself. */
export interface ActionFlags {
  readonly amount: bigint | undefined;
  readonly amountError: string;
  readonly destinationError: string;
  readonly failure: string;
  readonly hasCollectable: boolean;
  readonly hasDestination: boolean;
  readonly isFrozen: boolean;
  readonly isPreparing: boolean;
  readonly isStateFetching: boolean;
  readonly isTxPreviewFetching: boolean;
  readonly message: string;
  readonly unavailableMessage: string;
}

/** Resolves the status message shown beside the conversion action button. */
export function actionMessage(txInfo: TxInfo, flags: ActionFlags): string {
  const { amount, amountError, destinationError, failure, hasDestination } = flags;
  if (failure !== "") {
    return failureMessage(failure);
  }

  if (flags.isFrozen || flags.isPreparing) {
    return flags.message;
  }

  if (amount === undefined) {
    return amountError === ""
      ? "Finish entering the amount."
      : failureMessage(amountError);
  }

  if (!hasDestination) {
    return destinationError === ""
      ? "Checking the destination address..."
      : failureMessage(destinationError);
  }

  if (flags.isStateFetching) {
    return "Refreshing wallet data...";
  }

  if (flags.isTxPreviewFetching) {
    return amount > 0n ? "Checking conversion request..." : "Checking converted funds...";
  }

  return previewMessage(txInfo, flags.hasCollectable, flags.unavailableMessage);
}

function previewMessage(
  txInfo: TxInfo,
  hasCollectable: boolean,
  unavailableMessage: string,
): string {
  if (txInfo.error !== "") {
    // The preview lags the typed amount by the settle delay, so an availability error is
    // worded for the amount on screen, not the one the preview was built for.
    return isAvailabilityMessage(txInfo.error)
      ? `${unavailableMessage}.`
      : failureMessage(txInfo.error);
  }

  const hasActivity = hasTransactionActivity(txInfo.tx);
  if (!hasActivity) {
    return `${unavailableMessage}.`;
  }

  if (!isTxInfoValid(txInfo, hasActivity)) {
    return "Transaction preview is not ready.";
  }

  return transactionIntentMessage(txInfo, hasCollectable);
}

/**
 * Another address as the destination means leaving this wallet: the sweep is the
 * transaction, always at amount zero, so it replaces the collect-only intent; converting
 * positions stay, and a sweep the size budget cut short asks for another run (52(al)).
 */
export function transactionIntentMessage(
  txInfo: Pick<TxInfo, "conversionKind" | "conversionNotice" | "move">,
  hasCollectable: boolean,
): string {
  const { move } = txInfo;
  if (move !== undefined) {
    return [
      `Sends all CKB and iCKB in this wallet to ${move.to}, without converting.`,
      collectableNotice(hasCollectable),
      "Funds still converting stay here: collect them from this wallet later.",
      move.isComplete ? "" : "Run it again until everything has been sent.",
    ]
      .filter((text) => text !== "")
      .join(" ");
  }
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

/**
 * The frozen preview's message: what the signed transaction does, then the ask. Releasing
 * the preview clears it; both callers have already cleared the message by then.
 */
export function confirmPreviewMessage(
  preview: { txInfo: TxInfo; hasCollectable: boolean } | undefined,
): string {
  if (preview === undefined) {
    return "";
  }
  return [
    transactionIntentMessage(preview.txInfo, preview.hasCollectable),
    "Confirm the transaction in your wallet.",
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

function conversionNoticeText(notice: NonNullable<TxInfo["conversionNotice"]>): string {
  return `This small request converts ${toText(notice.inputIckb)} iCKB to about ${toText(notice.outputCkb)} CKB and pays ${toText(notice.incentiveCkb)} CKB for the variable time.`;
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
  // What the signed transaction does, in the user's terms. "Below" is the "Ready:" line,
  // the SDK's latest-of-everything estimate, pending positions included, so the mixed case
  // points at it for both parts and no sentence calls it one part's date.
  const intent: Record<NonNullable<TxInfo["conversionKind"]>, string> = {
    "collect-only": "Collects your converted funds.",
    direct: "Converts at a fixed time, shown below.",
    order: "Converts at a variable time, estimated below.",
    "direct-plus-order":
      "Part converts at a fixed time, the rest at a variable time, estimated below.",
  };

  return intent[kind];
}

/** Returns true only for a broadcastable preview with real transaction activity. */
export function isTxInfoValid(txInfo: TxInfo, hasActivity: boolean): boolean {
  return hasActivity && txInfo.fee > 0n && txInfo.error === "";
}

export function actionLabel(
  amount: bigint | undefined,
  hasCollectable: boolean,
  isMove: boolean,
): string {
  if (isMove) {
    return "send all CKB and iCKB";
  }
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

/** Completes the "Ready:" label: "now" or "in 3 days". */
export function timeUntilMaturity(
  estimatedMaturity: bigint,
  tipTimestamp: bigint,
): string {
  const remaining = estimatedMaturity - tipTimestamp;
  if (remaining <= 0n) {
    return "now";
  }

  const minute = 60_000n;

  if (remaining <= 90n * minute) {
    return `in ${String(Number((remaining + minute - 1n) / minute))} minutes`;
  }

  const hour = 60n * minute;
  const day = 24n * hour;

  if (remaining <= day) {
    return `in ${String(Number((remaining + hour - 1n) / hour))} hours`;
  }

  return `in ${String(Number((remaining + day - 1n) / day))} days`;
}
