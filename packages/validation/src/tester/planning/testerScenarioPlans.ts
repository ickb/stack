import { ICKB_DEPOSIT_CAP } from "@ickb/core";
import type { TesterState } from "../runtime/runtime.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB,
  DEFAULT_TESTER_FEE_POLICY,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_SCENARIOS,
  SDK_CONVERSION_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  TesterTerminalError,
  type TesterFeePolicy,
  type TesterPlan,
  type TesterScenario,
} from "../runtime/testerTypes.ts";
import {
  ckbSpendingOrderBudget,
  isActionableRawOrder,
  min,
  plannedRawOrders,
} from "./testerOrderPlanning.ts";
import { planRandomOrderTransaction } from "./testerRandomPlanning.ts";
import { planSdkConversionTransaction } from "./testerSdkPlanning.ts";

type MultiOrderScenario = (typeof MULTI_ORDER_SCENARIOS)[number];

export function planTesterTransaction(
  state: TesterState,
  depositCapacity: bigint,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
): TesterPlan {
  const effectiveScenario =
    scenario === MULTI_ORDER_LIMIT_ORDERS_SCENARIO
      ? resolveMultiOrderScenario(state, feePolicy)
      : scenario;
  const planner = testerScenarioPlanner(effectiveScenario);
  if (planner !== undefined) {
    return planner(state, depositCapacity);
  }
  const spendableCkbBalance = ckbSpendingOrderBudget(state.availableCkbBalance);
  return planRandomOrderTransaction(
    state,
    depositCapacity,
    feePolicy,
    spendableCkbBalance,
  );
}

export function resolveMultiOrderScenario(
  state: TesterState,
  feePolicy: TesterFeePolicy,
): TesterScenario {
  const selected = MULTI_ORDER_SCENARIOS.find((candidate) =>
    hasActionableMultiOrderEstimates(state, candidate, feePolicy),
  );
  if (selected !== undefined) {
    return selected;
  }
  throw new TesterTerminalError("Not enough funds for multi-order limit orders scenario");
}

function hasActionableMultiOrderEstimates(
  state: TesterState,
  scenario: MultiOrderScenario,
  feePolicy: TesterFeePolicy,
): boolean {
  try {
    const plan = planTesterTransaction(state, 0n, scenario, feePolicy);
    const orders = plannedRawOrders(plan, scenario);
    return (
      orders.length >= 2 &&
      orders.every((order) => isActionableRawOrder(order, state.system, feePolicy))
    );
  } catch (error) {
    if (error instanceof TesterTerminalError) {
      return false;
    }
    throw error;
  }
}

type TesterScenarioPlanner = (state: TesterState, depositCapacity: bigint) => TesterPlan;

const TESTER_SCENARIO_PLANNERS: Partial<Record<TesterScenario, TesterScenarioPlanner>> = {
  [SDK_CONVERSION_SCENARIO]: planSdkConversionTransaction,
  [EXTRA_LARGE_LIMIT_ORDER_SCENARIO]: planExtraLargeLimitOrder,
  [TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO]: (state) => planAllCkbLimitOrder(state, 2),
  [ALL_CKB_LIMIT_ORDER_SCENARIO]: (state) => planAllCkbLimitOrder(state, 1),
  [ICKB_TO_CKB_LIMIT_ORDER_SCENARIO]: (state) =>
    planIckbToCkbLimitOrder(state.availableIckbBalance, 1),
  [BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO]: (state) =>
    planIckbToCkbLimitOrder(min(ICKB_DEPOSIT_CAP, state.availableIckbBalance), 1),
  [TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO]: (state) =>
    planIckbToCkbLimitOrder(state.availableIckbBalance, 2),
  [MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO]: planMixedDirectionLimitOrders,
  [DUST_CKB_CONVERSION_SCENARIO]: planDustCkbConversion,
  [DUST_ICKB_CONVERSION_SCENARIO]: planDustIckbConversion,
};

function testerScenarioPlanner(
  scenario: TesterScenario,
): TesterScenarioPlanner | undefined {
  return TESTER_SCENARIO_PLANNERS[scenario];
}

function planExtraLargeLimitOrder(
  state: TesterState,
  depositCapacity: bigint,
): TesterPlan {
  const ckbAmount = depositCapacity * 2n;
  if (ckbSpendingOrderBudget(state.availableCkbBalance) < ckbAmount) {
    throw new TesterTerminalError("Not enough CKB for extra-large limit order scenario");
  }
  return ckbToIckbTesterPlan(ckbAmount, 1);
}

function planAllCkbLimitOrder(state: TesterState, orderCount: number): TesterPlan {
  const ckbAmount = ckbSpendingOrderBudget(state.availableCkbBalance);
  const minimum = BigInt(orderCount);
  if (ckbAmount < minimum) {
    throw new TesterTerminalError(
      orderCount === 1
        ? "Not enough CKB for all-CKB limit order scenario"
        : "Not enough CKB for two CKB-to-iCKB limit orders scenario",
    );
  }
  return ckbToIckbTesterPlan(ckbAmount, orderCount);
}

function planIckbToCkbLimitOrder(udtAmount: bigint, orderCount: number): TesterPlan {
  const minimum = BigInt(orderCount);
  if (udtAmount < minimum) {
    throw new TesterTerminalError(
      orderCount === 1
        ? "Not enough iCKB for iCKB-to-CKB limit order scenario"
        : "Not enough iCKB for two iCKB-to-CKB limit orders scenario",
    );
  }
  return ickbToCkbTesterPlan(udtAmount, orderCount);
}

function planMixedDirectionLimitOrders(state: TesterState): TesterPlan {
  const ckbAmount = ckbSpendingOrderBudget(state.availableCkbBalance);
  if (ckbAmount <= 0n) {
    throw new TesterTerminalError(
      "Not enough CKB for mixed-direction limit orders scenario",
    );
  }
  if (state.availableIckbBalance <= 0n) {
    throw new TesterTerminalError(
      "Not enough iCKB for mixed-direction limit orders scenario",
    );
  }
  return {
    direction: CKB_TO_ICKB,
    amount: ckbAmount + state.availableIckbBalance,
    ckbAmount,
    udtAmount: state.availableIckbBalance,
    orderCount: 2,
  };
}

function planDustCkbConversion(state: TesterState): TesterPlan {
  if (ckbSpendingOrderBudget(state.availableCkbBalance) < 1n) {
    throw new TesterTerminalError("Not enough CKB for dust CKB conversion scenario");
  }
  return ckbToIckbTesterPlan(1n, 1);
}

function planDustIckbConversion(state: TesterState): TesterPlan {
  if (state.availableIckbBalance < 1n) {
    throw new TesterTerminalError("Not enough iCKB for dust iCKB conversion scenario");
  }
  return ickbToCkbTesterPlan(1n, 1);
}

function ckbToIckbTesterPlan(ckbAmount: bigint, orderCount: number): TesterPlan {
  return {
    direction: CKB_TO_ICKB,
    amount: ckbAmount,
    ckbAmount,
    udtAmount: 0n,
    orderCount,
  };
}

function ickbToCkbTesterPlan(udtAmount: bigint, orderCount: number): TesterPlan {
  return {
    direction: ICKB_TO_CKB,
    amount: udtAmount,
    ckbAmount: 0n,
    udtAmount,
    orderCount,
  };
}
