import { ccc } from "@ckb-ccc/ccc";
import {
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
} from "@ickb/sdk";
import {
  errorMessageOf,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "./utils.ts";

export interface TransactionContext extends ConversionTransactionContext {
  capacityCells: ccc.Cell[];
  nativeUdtCells: ccc.Cell[];
}

export async function buildTransactionPreview(
  context: TransactionContext,
  isCkb2Udt: boolean,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  try {
    if (amount < 0n) {
      return txInfoWithError("Amount must be positive", context.estimatedMaturity);
    }

    if (isCkb2Udt && amount > context.ckbAvailable) {
      return txInfoWithError("Not enough CKB", context.estimatedMaturity);
    }

    if (!isCkb2Udt && amount > context.ickbAvailable) {
      return txInfoWithError("Not enough iCKB", context.estimatedMaturity);
    }

    const result = await walletConfig.sdk.buildConversionTransaction(
      ccc.Transaction.default(),
      walletConfig.cccClient,
      {
        direction: isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
        amount,
        lock: walletConfig.primaryLock,
        context,
      },
    );
    if (!result.ok) {
      return txInfoWithError(
        conversionFailureMessage(result.reason),
        result.estimatedMaturity,
      );
    }

    return await finalizeTransaction(
      result.tx,
      result.estimatedMaturity,
      context.system.feeRate,
      walletConfig,
      result.conversionNotice,
    );
  } catch (error) {
    return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
  }
}

async function finalizeTransaction(
  tx: ccc.Transaction,
  estimatedMaturity: bigint,
  feeRate: ccc.Num,
  walletConfig: WalletConfig,
  conversionNotice?: TxInfo["conversionNotice"],
): Promise<TxInfo> {
  tx = await walletConfig.sdk.completeTransaction(tx, {
    signer: walletConfig.signer,
    client: walletConfig.cccClient,
    feeRate,
  });

  return Object.freeze({
    tx,
    error: "",
    fee: await tx.getFee(walletConfig.cccClient),
    estimatedMaturity,
    ...(conversionNotice ? { conversionNotice } : {}),
  });
}

function txInfoWithError(error: string, estimatedMaturity: bigint): TxInfo {
  return Object.freeze({
    ...txInfoPadding,
    error,
    estimatedMaturity,
  });
}

function conversionFailureMessage(reason: ConversionTransactionFailureReason): string {
  switch (reason) {
    case "amount-negative":
      return "Amount must be positive";
    case "insufficient-ckb":
      return "Not enough CKB";
    case "insufficient-ickb":
      return "Not enough iCKB";
    case "amount-too-small":
      return "Amount too small to exceed the minimum match and fee threshold";
    case "not-enough-ready-deposits":
      return "Not enough ready deposits to convert now";
    case "nothing-to-do":
      return "Nothing to do for now";
  }
}
