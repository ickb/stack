import type { ccc } from "@ckb-ccc/core";
import type { ConversionMetadata, ConversionNotice } from "@ickb/sdk";
import { formatCkb } from "../../../shared/index.ts";
import type { TesterState } from "../runtime/runtime.ts";
import {
  AUTO_TESTER_SCENARIOS,
  CKB_TO_ICKB,
  ESTIMATED_CONVERSION_TOO_SMALL,
  type EstimatedRawOrder,
  type PlannedOrderLog,
  type PlannedRawOrder,
  type TesterAttemptedOrderEvidence,
  type TesterExecutionActions,
  type TesterFeePolicy,
  type TesterOrderEvidence,
  type TesterScenario,
  type TesterScenarioEvidence,
  type TesterScenarioSelection,
  type TesterSkip,
  type TransactionShape,
} from "../runtime/testerTypes.ts";

/**
 * Builds the public action summary for one tester transaction attempt.
 */
export function testerExecutionActions({
  requestedScenario,
  effectiveScenario,
  conversion,
  conversionNotice,
  estimatedOrders,
  feePolicy,
  state,
}: {
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  conversion: ConversionMetadata | undefined;
  conversionNotice: ConversionNotice | undefined;
  estimatedOrders: EstimatedRawOrder[];
  feePolicy: TesterFeePolicy;
  state: TesterState;
}): TesterExecutionActions {
  const collectedOrders = state.userOrders.length;
  const cancelledOrders = state.userOrders.filter((group) =>
    group.order.isMatchable(),
  ).length;
  return {
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...(conversion === undefined
      ? orderEvidence(estimatedOrders, feePolicy)
      : {
          conversion,
          ...(conversionNotice === undefined ? {} : { conversionNotice }),
        }),
    collectedOrders,
    cancelledOrders,
  };
}
/**
 * Builds skip evidence for an SDK conversion estimate that is too small to send.
 */
export function testerSdkConversionNoticeSkip({
  requestedScenario,
  effectiveScenario,
  conversion,
  conversionNotice,
  orderEvidence,
}: {
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  conversion: ConversionMetadata;
  conversionNotice: ConversionNotice;
  orderEvidence: TesterAttemptedOrderEvidence;
}): TesterSkip {
  return {
    reason: ESTIMATED_CONVERSION_TOO_SMALL,
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    attemptedConversion: conversion,
    conversionNotice,
    ...orderEvidence,
  };
}
/**
 * Builds skip evidence when estimated raw limit orders are too small to send.
 */
export function testerEstimatedTooSmallSkip({
  requestedScenario,
  effectiveScenario,
  rawOrders,
  estimatedOrders,
  feePolicy,
}: {
  requestedScenario: TesterScenarioSelection;
  effectiveScenario: TesterScenario;
  rawOrders: PlannedRawOrder[];
  estimatedOrders: EstimatedRawOrder[];
  feePolicy: TesterFeePolicy;
}): TesterSkip {
  return {
    reason: ESTIMATED_CONVERSION_TOO_SMALL,
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...attemptedOrderEvidence(rawOrders, estimatedOrders, feePolicy),
  };
}
/**
 * Builds skip evidence when auto mode cannot find any currently actionable tester scenario.
 */
export function testerNoActionableAutoScenarioSkip(): TesterSkip {
  return {
    reason: ESTIMATED_CONVERSION_TOO_SMALL,
    requestedTesterScenario: "auto",
    attemptedTesterScenarios: [...AUTO_TESTER_SCENARIOS],
  };
}
/**
 * Builds evidence for a transaction that was planned but skipped before send.
 */
export function testerAttemptedTransactionEvidence(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  conversion: ConversionMetadata | undefined,
  orderEvidence: TesterAttemptedOrderEvidence,
): TesterScenarioEvidence &
  (TesterAttemptedOrderEvidence | { attemptedConversion: ConversionMetadata }) {
  return {
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...(conversion === undefined ? orderEvidence : { attemptedConversion: conversion }),
  };
}
function testerScenarioEvidence(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
): TesterScenarioEvidence {
  return {
    ...(effectiveScenario === requestedScenario
      ? {}
      : { requestedTesterScenario: requestedScenario }),
    testerScenario: effectiveScenario,
  };
}
/**
 * Returns stable transaction-size counters for tester logs.
 */
export function transactionShape(tx: ccc.Transaction): TransactionShape {
  return {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
    outputsData: tx.outputsData.length,
    cellDeps: tx.cellDeps.length,
    headerDeps: tx.headerDeps.length,
    witnesses: tx.witnesses.length,
  };
}
function orderEvidence(
  orders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
): TesterOrderEvidence {
  const logs = orders.map((order) => orderLog(order, feePolicy));
  const [first] = logs;
  return logs.length === 1 && first !== undefined
    ? { newOrder: first }
    : { newOrders: logs, orderCount: logs.length };
}
export function attemptedOrderEvidence(
  rawOrders: PlannedRawOrder[],
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
): TesterAttemptedOrderEvidence {
  const logs = rawOrders.map((order, index) =>
    attemptedOrderLog(order, estimatedOrders[index], feePolicy),
  );
  const [first] = logs;
  return logs.length === 1 && first !== undefined
    ? { attemptedOrder: first }
    : { attemptedOrders: logs, attemptedOrderCount: logs.length };
}
function attemptedOrderLog(
  order: PlannedRawOrder,
  estimatedOrder: EstimatedRawOrder | undefined,
  feePolicy: TesterFeePolicy,
): PlannedOrderLog {
  if (estimatedOrder !== undefined) {
    return orderLog(estimatedOrder, feePolicy);
  }
  const feeFields = feePolicyLog(feePolicy);
  return order.direction === CKB_TO_ICKB
    ? { giveCkb: formatCkb(order.amounts.ckbValue), ...feeFields }
    : { giveIckb: formatCkb(order.amounts.udtValue), ...feeFields };
}
function orderLog(order: EstimatedRawOrder, feePolicy: TesterFeePolicy): PlannedOrderLog {
  const feeFields = feePolicyLog(feePolicy);
  const converted = formatCkb(order.estimate.convertedAmount);
  const fee = formatCkb(order.estimate.ckbFee);
  return order.direction === CKB_TO_ICKB
    ? {
        giveCkb: formatCkb(order.amounts.ckbValue),
        takeIckb: converted,
        fee,
        ...feeFields,
      }
    : {
        giveIckb: formatCkb(order.amounts.udtValue),
        takeCkb: converted,
        fee,
        ...feeFields,
      };
}
function feePolicyLog(
  policy: TesterFeePolicy,
): Pick<PlannedOrderLog, "feeNumerator" | "feeBase"> {
  return {
    feeNumerator: policy.fee.toString(),
    feeBase: policy.feeBase.toString(),
  };
}
