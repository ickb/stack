import type { TesterState } from "../runtime/runtime.ts";
import type {
  EstimatedRawOrder,
  PlannedRawOrder,
  TesterFeePolicy,
  TesterScenario,
} from "../runtime/testerTypes.ts";
import {
  estimateRawOrder,
  isActionableEstimatedRawOrder,
  isSdkConversionScenario,
} from "./testerPlanning.ts";

export function estimateTesterRawOrders(
  rawOrders: PlannedRawOrder[],
  state: TesterState,
  effectiveFeePolicy: TesterFeePolicy,
): EstimatedRawOrder[] | undefined {
  const estimatedOrders: EstimatedRawOrder[] = [];
  for (const order of rawOrders) {
    const estimate = estimateRawOrder(order, state.system, effectiveFeePolicy);
    if (estimate === undefined) {
      return undefined;
    }
    estimatedOrders.push({ ...order, estimate });
  }
  return estimatedOrders;
}

export function hasTooSmallTesterRawOrder(
  estimatedOrders: EstimatedRawOrder[],
  state: TesterState,
  effectiveTesterScenario: TesterScenario,
): boolean {
  return isSdkConversionScenario(effectiveTesterScenario)
    ? estimatedOrders.some((order) => order.estimate.convertedAmount <= 0n)
    : estimatedOrders.some(
        (order) => !isActionableEstimatedRawOrder(order, state.system),
      );
}
