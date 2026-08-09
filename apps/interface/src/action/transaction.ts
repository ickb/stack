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
  "not-enough-ready-deposits": "Not enough ready liquidity. Lower the amount or wait",
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
        context,
      },
    );
    if (!result.ok) {
      return txInfoWithError(
        conversionFailureMessage(result.reason, amount),
        result.estimatedMaturity,
      );
    }

    return await finalizeTransaction({
      tx: result.tx,
      estimatedMaturity: result.estimatedMaturity,
      feeRate: context.system.feeRate,
      walletConfig,
      conversionKind: result.conversion.kind,
      conversionNotice: result.conversionNotice,
    });
  } catch (error) {
    return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
  }
}

interface FinalizeTransactionParams {
  readonly tx: ccc.Transaction;
  readonly estimatedMaturity: bigint;
  readonly feeRate: ccc.Num;
  readonly walletConfig: WalletConfig;
  readonly conversionKind: NonNullable<TxInfo["conversionKind"]>;
  readonly conversionNotice?: NonNullable<TxInfo["conversionNotice"]>;
}

async function finalizeTransaction({
  tx,
  estimatedMaturity,
  feeRate,
  walletConfig,
  conversionKind,
  conversionNotice,
}: FinalizeTransactionParams): Promise<TxInfo> {
  const completedTx = await walletConfig.sdk.completeTransaction(tx, {
    signer: walletConfig.signer,
    feeRate,
  });

  return Object.freeze({
    tx: completedTx,
    error: "",
    fee: await completedTx.getFee(walletConfig.signer.client),
    estimatedMaturity,
    conversionKind,
    ...(conversionNotice !== undefined ? { conversionNotice } : {}),
  });
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
