import { ccc } from "@ckb-ccc/ccc";
import {
  IckbError,
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
  type IckbErrorCode,
} from "@ickb/sdk";
import { errorMessageOf, type TxInfo, type WalletConfig } from "../shared/utils.ts";
import type { Destination } from "./destination.ts";

export const noCollectionMessage = "Nothing to do";
export const noRequestMessage = "No conversion request available for this amount";

const conversionFailureMessages: Record<
  Exclude<ConversionTransactionFailureReason, "nothing-to-do" | "amount-too-small">,
  string
> = {
  "amount-negative": "Amount cannot be negative",
  "insufficient-ckb": "More CKB than you have",
  "insufficient-ickb": "More iCKB than you have",
};

// Completion fails past the SDK's pre-check when the change cells, an order's master cell or
// the fee do not fit: the amount was within the balance, so the message names what ran out.
// It never says to lower the amount: at the displayed minimum there is nothing to lower, an
// iCKB-to-CKB order's cells cost the same at any amount, and a move has no amount.
const completionFailureMessages: Record<IckbErrorCode, string> = {
  insufficient_capacity: "Not enough spare CKB for the cells and the fee",
  insufficient_ickb: conversionFailureMessages["insufficient-ickb"],
};

/**
 * Builds a non-broadcast transaction preview for one conversion request.
 *
 * @returns A frozen TxInfo: the transaction to sign, or the error to show when the SDK
 * cannot produce one.
 */
export async function buildTransactionPreview(
  context: ConversionTransactionContext,
  isCkb2Udt: boolean,
  amount: bigint,
  destination: Destination,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  // A move carries only native CKB and iCKB, never a converting position, so it takes no
  // amount; the form fixes it at zero and this boundary refuses anything else.
  if (destination.moveTo !== undefined && amount !== 0n) {
    return txInfoWithError(
      "A move to another address takes no amount",
      context.estimatedMaturity,
    );
  }
  try {
    const result = await walletConfig.sdk.buildConversionTransaction({
      direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
      amount,
      lock: destination.lock,
      signer: walletConfig.signer,
      context,
    });
    if (!result.ok) {
      return txInfoWithError(
        conversionFailureMessage(result, amount, isCkb2Udt),
        context.estimatedMaturity,
      );
    }

    // The SDK returns the transaction completed and funded; only signing remains.
    return Object.freeze({
      ok: true,
      tx: result.tx,
      // The fee completion priced, which the send refuses to exceed.
      fee: result.plannedFee,
      estimatedMaturity: result.estimatedMaturity,
      conversionKind: result.conversionKind,
      ...(destination.moveTo === undefined
        ? {}
        : { move: { to: destination.moveTo, isComplete: result.isSweepComplete } }),
      ...(result.conversionNotice === undefined
        ? {}
        : { conversionNotice: result.conversionNotice }),
      ...(result.broadcastBefore === undefined
        ? {}
        : { broadcastBefore: result.broadcastBefore }),
    });
  } catch (error) {
    return txInfoWithError(
      error instanceof IckbError
        ? completionFailureMessages[error.code]
        : errorMessageOf(error),
      context.estimatedMaturity,
    );
  }
}

function txInfoWithError(error: string, estimatedMaturity: bigint): TxInfo {
  return Object.freeze({ ok: false, error, estimatedMaturity });
}

function conversionFailureMessage(
  failure: Extract<ConversionTransactionResult, { ok: false }>,
  amount: bigint,
  isCkb2Udt: boolean,
): string {
  if (failure.reason === "nothing-to-do") {
    return amount === 0n ? noCollectionMessage : noRequestMessage;
  }
  if (failure.reason === "amount-too-small") {
    return `Enter at least ${ccc.fixedPointToString(roundUpToTwoDigits(failure.minimum))} ${isCkb2Udt ? "CKB" : "iCKB"}`;
  }

  return conversionFailureMessages[failure.reason];
}

/** Rounds up to two significant digits, so a minimum reads as a round figure and still holds. */
function roundUpToTwoDigits(amount: bigint): bigint {
  const digits = amount.toString().length;
  if (digits <= 2) {
    return amount;
  }
  const unit = 10n ** BigInt(digits - 2);
  return ((amount + unit - 1n) / unit) * unit;
}
