import type { ccc } from "@ckb-ccc/core";
import { formatCkb } from "@ickb/node-utils";
import type { TesterState } from "../runtime/runtime.ts";
import {
  AUTO_TESTER_SCENARIOS,
  CKB_TO_ICKB,
  ESTIMATED_CONVERSION_TOO_SMALL,
  type EstimatedRawOrder,
  type PlannedOrderLog,
  type PlannedRawOrder,
  type TesterExecutionActions,
  type TesterFeePolicy,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../runtime/testerTypes.ts";

type OrderLogParameters = [
  isCkb2Udt: boolean,
  ckbAmount: bigint,
  udtAmount: bigint,
  convertedAmount: bigint,
  ckbFee: bigint,
  feePolicy: TesterFeePolicy,
];

export {
  enforceTesterPlainCkbReserve,
  postTransactionPlainCkbBalance,
  testerReserveSkip,
} from "./testerReserve.ts";
/**
 * Builds the public action summary for one tester transaction attempt.
 */
type TesterExecutionActionsParameters = [
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  conversion: unknown,
  conversionNotice: unknown,
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
  state: TesterState,
];
export function testerExecutionActions(
  ...[
    requestedScenario,
    effectiveScenario,
    conversion,
    conversionNotice,
    estimatedOrders,
    feePolicy,
    state,
  ]: TesterExecutionActionsParameters
): TesterExecutionActions {
  const conversionRecord = isRecord(conversion) ? conversion : undefined;
  const noticeRecord = isRecord(conversionNotice) ? conversionNotice : undefined;
  const collectedOrders = state.userOrders.length;
  const cancelledOrders = state.userOrders.filter((group) =>
    group.order.isMatchable(),
  ).length;
  return {
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...(conversionRecord === undefined ? {} : { conversion: conversionRecord }),
    ...(noticeRecord === undefined ? {} : { conversionNotice: noticeRecord }),
    ...(conversionRecord === undefined ? orderEvidence(estimatedOrders, feePolicy) : {}),
    collectedOrders,
    cancelledOrders,
  };
}
/**
 * Builds skip evidence for an SDK conversion estimate that is too small to send.
 */
type TesterSdkConversionNoticeSkipParameters = [
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  conversion: unknown,
  conversionNotice: unknown,
  orderEvidence: Record<string, unknown>,
];
export function testerSdkConversionNoticeSkip(
  ...[
    requestedScenario,
    effectiveScenario,
    conversion,
    conversionNotice,
    orderEvidence,
  ]: TesterSdkConversionNoticeSkipParameters
): Record<string, unknown> {
  const conversionRecord = isRecord(conversion) ? conversion : undefined;
  const noticeRecord = isRecord(conversionNotice) ? conversionNotice : undefined;
  return {
    reason: ESTIMATED_CONVERSION_TOO_SMALL,
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...(conversionRecord === undefined ? {} : { attemptedConversion: conversionRecord }),
    ...(noticeRecord === undefined ? {} : { conversionNotice: noticeRecord }),
    ...orderEvidence,
  };
}
/**
 * Builds skip evidence when estimated raw limit orders are too small to send.
 */
type TesterEstimatedTooSmallSkipParameters = [
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
  rawOrders: PlannedRawOrder[],
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
];
export function testerEstimatedTooSmallSkip(
  ...[
    requestedScenario,
    effectiveScenario,
    rawOrders,
    estimatedOrders,
    feePolicy,
  ]: TesterEstimatedTooSmallSkipParameters
): Record<string, unknown> {
  return {
    reason: ESTIMATED_CONVERSION_TOO_SMALL,
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...attemptedOrderEvidence(rawOrders, estimatedOrders, feePolicy),
  };
}
/**
 * Builds skip evidence when auto mode cannot find any currently actionable tester scenario.
 */
export function testerNoActionableAutoScenarioSkip(): Record<string, unknown> {
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
  conversion: unknown,
  orderEvidence: Record<string, unknown>,
): Record<string, unknown> {
  const conversionRecord = isRecord(conversion) ? conversion : undefined;
  return {
    ...testerScenarioEvidence(requestedScenario, effectiveScenario),
    ...(conversionRecord === undefined
      ? orderEvidence
      : { attemptedConversion: conversionRecord }),
  };
}
function testerScenarioEvidence(
  requestedScenario: TesterScenarioSelection,
  effectiveScenario: TesterScenario,
): Record<string, unknown> {
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
export function transactionShape(tx: ccc.Transaction): Record<string, number> {
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
): Record<string, unknown> {
  const logs = orders.map((order) =>
    orderLog(
      order.direction === CKB_TO_ICKB,
      order.amounts.ckbValue,
      order.amounts.udtValue,
      order.estimate.convertedAmount,
      order.estimate.ckbFee,
      feePolicy,
    ),
  );
  const [first] = logs;
  return logs.length === 1 && first !== undefined
    ? { newOrder: first }
    : { newOrders: logs, orderCount: logs.length };
}
export function attemptedOrderEvidence(
  rawOrders: PlannedRawOrder[],
  estimatedOrders: EstimatedRawOrder[],
  feePolicy: TesterFeePolicy,
): Record<string, unknown> {
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
    return orderLog(
      estimatedOrder.direction === CKB_TO_ICKB,
      estimatedOrder.amounts.ckbValue,
      estimatedOrder.amounts.udtValue,
      estimatedOrder.estimate.convertedAmount,
      estimatedOrder.estimate.ckbFee,
      feePolicy,
    );
  }
  const feeFields = feePolicyLog(feePolicy);
  return order.direction === CKB_TO_ICKB
    ? { giveCkb: formatCkb(order.amounts.ckbValue), ...feeFields }
    : { giveIckb: formatCkb(order.amounts.udtValue), ...feeFields };
}
function orderLog(
  ...[
    isCkb2Udt,
    ckbAmount,
    udtAmount,
    convertedAmount,
    ckbFee,
    feePolicy,
  ]: OrderLogParameters
): PlannedOrderLog {
  const feeFields = feePolicyLog(feePolicy);
  return isCkb2Udt
    ? {
        giveCkb: formatCkb(ckbAmount),
        takeIckb: formatCkb(convertedAmount),
        fee: formatCkb(ckbFee),
        ...feeFields,
      }
    : {
        giveIckb: formatCkb(udtAmount),
        takeCkb: formatCkb(convertedAmount),
        fee: formatCkb(ckbFee),
        ...feeFields,
      };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function feePolicyLog(
  policy: TesterFeePolicy,
): Pick<PlannedOrderLog, "feeNumerator" | "feeBase"> {
  return {
    feeNumerator: policy.fee.toString(),
    feeBase: policy.feeBase.toString(),
  };
}
