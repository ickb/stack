import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../core/index.ts";
import {
  NOTHING_TO_DO_REASON,
  type BuildBaseTransactionOptions,
  type ConversionMetadata,
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
} from "./sdk_types.ts";

export function conversionFailure(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity: bigint,
  minimum?: bigint,
): ConversionTransactionResult {
  return {
    ok: false,
    reason,
    estimatedMaturity,
    ...(minimum === undefined ? {} : { minimum }),
  };
}

export function baseTransactionOptions(
  context: ConversionTransactionContext,
  withdrawalRequest?: { deposits: IckbDepositCell[]; lock: ccc.Script },
): BuildBaseTransactionOptions {
  return {
    ...(withdrawalRequest === undefined || withdrawalRequest.deposits.length === 0
      ? {}
      : { withdrawalRequest }),
    orders: context.availableOrders,
    receipts: context.receipts,
    readyWithdrawals: context.readyWithdrawals,
  };
}

export function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
}

export function conversionKind(
  hasDirect: boolean,
  hasOrder: boolean,
): ConversionMetadata["kind"] {
  if (hasDirect && hasOrder) {
    return "direct-plus-order";
  }
  if (hasDirect) {
    return "direct";
  }
  if (hasOrder) {
    return "order";
  }
  return "collect-only";
}

export { NOTHING_TO_DO_REASON };
