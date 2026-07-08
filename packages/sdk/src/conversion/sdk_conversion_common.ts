import { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import { DAO_OUTPUT_LIMIT, DaoOutputLimitError } from "@ickb/dao";
import {
  NOTHING_TO_DO_REASON,
  ORDER_MINT_OUTPUTS,
  type BuildBaseTransactionOptions,
  type ConversionMetadata,
  type ConversionOrder,
  type ConversionTransactionContext,
  type ConversionTransactionFailureReason,
  type ConversionTransactionResult,
} from "../client/sdk_types.ts";

export function conversionFailure(
  reason: ConversionTransactionFailureReason,
  estimatedMaturity: bigint,
): ConversionTransactionResult {
  return { ok: false, reason, estimatedMaturity };
}

export function baseTransactionOptions(
  context: ConversionTransactionContext,
  withdrawalRequest?: {
    deposits: IckbDepositCell[];
    requiredLiveDeposits: IckbDepositCell[];
    lock: ccc.Script;
  },
): BuildBaseTransactionOptions {
  return {
    ...(withdrawalRequest === undefined || withdrawalRequest.deposits.length === 0
      ? {}
      : {
          withdrawalRequest: {
            deposits: withdrawalRequest.deposits,
            ...(withdrawalRequest.requiredLiveDeposits.length > 0
              ? { requiredLiveDeposits: withdrawalRequest.requiredLiveDeposits }
              : {}),
            lock: withdrawalRequest.lock,
          },
        }),
    orders: context.availableOrders,
    receipts: context.receipts,
    readyWithdrawals: context.readyWithdrawals,
  };
}

export function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
}

export function isChangeCellCapacityError(error: unknown): boolean {
  return error instanceof ccc.ErrorTransactionInsufficientCapacity && error.isForChange;
}

export function isRetryableConversionBuildError(error: unknown): boolean {
  return (
    error instanceof DaoOutputLimitError ||
    (error instanceof Error && error.name === "DaoOutputLimitError")
  );
}

export function plannedDaoOutputLimitError(
  tx: ccc.Transaction,
  additionalOutputs: number,
  hasDaoActivity: boolean,
): DaoOutputLimitError | undefined {
  if (!hasDaoActivity) {
    return undefined;
  }

  const outputCount = tx.outputs.length + additionalOutputs;
  return outputCount > DAO_OUTPUT_LIMIT
    ? new DaoOutputLimitError(outputCount)
    : undefined;
}

export function orderOutputCount(order: ConversionOrder | undefined): number {
  return order === undefined ? 0 : ORDER_MINT_OUTPUTS;
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
