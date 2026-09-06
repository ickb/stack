import { ccc } from "@ckb-ccc/ccc";
import type {
  ConversionTransactionContext,
  ConversionTransactionFailureReason,
} from "@ickb/sdk";
import {
  errorMessageOf,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "../shared/utils.ts";

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

export interface TransactionContext extends ConversionTransactionContext {
  capacityCells: ccc.Cell[];
  nativeUdtCells: ccc.Cell[];
}

/**
 * Builds a non-broadcast transaction preview for one conversion request.
 *
 * @returns A frozen TxInfo with an empty error on success, or a non-empty error when the SDK cannot produce a broadcastable transaction.
 */
export async function buildTransactionPreview(
  context: TransactionContext,
  isCkb2Udt: boolean,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  try {
    const result = await walletConfig.sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      {
        direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
        amount,
        lock: walletConfig.primaryLock,
        signer: walletConfig.signer,
        context,
      },
    );
    if (!result.ok) {
      return txInfoWithError(
        conversionFailureMessage(result.reason, amount),
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
  reason: ConversionTransactionFailureReason,
  amount: bigint,
): string {
  if (reason === "nothing-to-do") {
    return amount === 0n ? noCollectionMessage : noRequestMessage;
  }

  return conversionFailureMessages[reason];
}
