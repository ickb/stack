import { ccc } from "@ckb-ccc/ccc";
import type {
  ConversionTransactionContext,
  ConversionTransactionFailureReason,
} from "@ickb/sdk";
import {
  errorMessageOf,
  toText,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "../shared/utils.ts";
import type { Destination } from "./destination.ts";

export const noCollectionMessage = "Nothing to do";
export const noRequestMessage = "No conversion request available for this amount";

const conversionFailureMessages: Record<
  Exclude<ConversionTransactionFailureReason, "nothing-to-do">,
  string
> = {
  "amount-negative": "Amount cannot be negative",
  "insufficient-ckb": "Not enough available CKB for this amount",
  "insufficient-ickb": "Not enough available iCKB for this amount",
  "amount-too-small": "Enter a larger amount",
};

export type TransactionContext = ConversionTransactionContext;

/**
 * Builds a non-broadcast transaction preview for one conversion request.
 *
 * @returns A frozen TxInfo with an empty error on success, or a non-empty error when the SDK cannot produce a broadcastable transaction.
 */
export async function buildTransactionPreview(
  context: TransactionContext,
  isCkb2Udt: boolean,
  amount: bigint,
  destination: Destination,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  try {
    const result = await walletConfig.sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      {
        direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
        amount,
        lock: destination.lock,
        signer: walletConfig.signer,
        context,
      },
    );
    if (!result.ok) {
      return txInfoWithError(
        conversionFailureMessage(result, amount, isCkb2Udt),
        result.estimatedMaturity,
      );
    }

    // The SDK returns the transaction completed and funded; only signing remains.
    return Object.freeze({
      tx: result.tx,
      error: "",
      fee: await result.tx.getFee(walletConfig.signer.client),
      estimatedMaturity: result.estimatedMaturity,
      conversionKind: result.conversion.kind,
      ...(destination.moveTo === undefined ? {} : { moveTo: destination.moveTo }),
      ...(result.conversionNotice === undefined
        ? {}
        : { conversionNotice: result.conversionNotice }),
    });
  } catch (error) {
    return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
  }
}

function txInfoWithError(error: string, estimatedMaturity: bigint): TxInfo {
  return Object.freeze({
    ...txInfoPadding,
    error,
    estimatedMaturity,
  });
}

function conversionFailureMessage(
  { reason, minimum }: { reason: ConversionTransactionFailureReason; minimum?: bigint },
  amount: bigint,
  isCkb2Udt: boolean,
): string {
  if (reason === "nothing-to-do") {
    return amount === 0n ? noCollectionMessage : noRequestMessage;
  }
  if (reason === "amount-too-small" && minimum !== undefined) {
    return `Enter at least ${toText(roundUpToTwoDigits(minimum))} ${isCkb2Udt ? "CKB" : "iCKB"}`;
  }

  return conversionFailureMessages[reason];
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
