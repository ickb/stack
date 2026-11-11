import { ccc } from "@ckb-ccc/ccc";
import type {
  ConversionTransactionFailureReason,
  ConversionTransactionResult,
  State,
} from "@ickb/sdk";
import { errorMessageOf, type TxInfo, type WalletConfig } from "../shared/utils.ts";

export const noCollectionMessage = "Nothing to do";
export const noRequestMessage = "No conversion request available for this amount";

const conversionFailureMessages: Record<
  Exclude<ConversionTransactionFailureReason, "amount-too-small">,
  string
> = {
  "insufficient-ckb": "More CKB than you have",
  "insufficient-ickb": "More iCKB than you have",
  // Completion fails past the SDK's pre-check when the change cells, an order's master cell
  // or the fee do not fit: the amount was within the balance, so the message names what ran
  // out. It never says to lower the amount: at the displayed minimum there is nothing to
  // lower, an iCKB-to-CKB order's cells cost the same at any amount.
  "insufficient-capacity": "Not enough spare CKB for the cells and the fee",
};

/**
 * Builds a non-broadcast transaction preview for one conversion request.
 *
 * @returns A frozen TxInfo: the transaction to sign, or the error to show when the SDK
 * cannot produce one.
 */
export async function buildTransactionPreview(
  state: State,
  isCkb2Udt: boolean,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  // The SDK refuses a collection with nothing to collect, which this screen offers anyway.
  if (amount === 0n && !state.hasCollectable) {
    return txInfoWithError(noCollectionMessage);
  }
  try {
    const result = await walletConfig.sdk.buildConversionTransaction({
      direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
      amount,
      signer: walletConfig.signer,
      state,
    });
    if (!result.ok) {
      return txInfoWithError(conversionFailureMessage(result, isCkb2Udt));
    }

    // The SDK returns the transaction completed and funded; only signing remains.
    return Object.freeze({
      ok: true,
      tx: result.tx,
      plannedFee: result.plannedFee,
      estimatedMaturity: result.estimatedMaturity,
      conversionKind: result.conversionKind,
      ...(result.orderOccupiedCapacity === undefined
        ? {}
        : { orderOccupiedCapacity: result.orderOccupiedCapacity }),
      ...(result.broadcastBefore === undefined
        ? {}
        : { broadcastBefore: result.broadcastBefore }),
    });
  } catch (error) {
    return txInfoWithError(errorMessageOf(error));
  }
}

function txInfoWithError(error: string): TxInfo {
  return Object.freeze({ ok: false, error });
}

function conversionFailureMessage(
  failure: Extract<ConversionTransactionResult, { ok: false }>,
  isCkb2Udt: boolean,
): string {
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
