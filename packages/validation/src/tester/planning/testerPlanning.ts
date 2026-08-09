import type { TesterState } from "../runtime/runtime.ts";
import {
  AUTO_TESTER_SCENARIOS,
  DEFAULT_TESTER_FEE_POLICY,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TesterTerminalError,
  type TesterFeePolicy,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../runtime/testerTypes.ts";
import { randomTesterScenario } from "./testerConfig.ts";
import {
  isActionableRawOrder,
  isSdkConversionScenario,
  plannedRawOrders,
} from "./testerOrderPlanning.ts";
import { hasActionableRandomOrderEstimate } from "./testerRandomPlanning.ts";
import {
  planTesterTransaction,
  resolveMultiOrderScenario,
} from "./testerScenarioPlans.ts";
import { hasBuildableSdkConversionEstimate } from "./testerSdkPlanning.ts";

/** Options for resolving `auto` or composite tester scenarios. */
export interface ResolveTesterScenarioOptions {
  /** State snapshot for the current attempt. */
  state: TesterState;

  /** Requested scenario selector. */
  scenario: TesterScenarioSelection;

  /** Raw-order fee policy. */
  feePolicy?: TesterFeePolicy;

  /** Capacity needed for one direct deposit. */
  depositCapacity?: bigint;

  /** Random source used only when resolving `auto`. */
  random?: () => number;
}

/** Resolves a configured scenario into a concrete actionable scenario when possible. */
export function resolveTesterScenario({
  state,
  scenario,
  feePolicy = DEFAULT_TESTER_FEE_POLICY,
  depositCapacity = 0n,
  random = Math.random,
}: ResolveTesterScenarioOptions): TesterScenario | undefined {
  if (scenario === "auto") {
    const fundedScenarios = fundedTesterScenarios(
      state,
      depositCapacity,
      feePolicy,
      AUTO_TESTER_SCENARIOS,
    );
    if (fundedScenarios.length === 0) {
      return undefined;
    }
    return randomTesterScenario(random, fundedScenarios);
  }
  if (scenario !== MULTI_ORDER_LIMIT_ORDERS_SCENARIO) {
    return scenario;
  }
  return resolveMultiOrderScenario(state, feePolicy);
}

function fundedTesterScenarios(
  state: TesterState,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
  candidates: readonly TesterScenario[],
): TesterScenario[] {
  return candidates.filter((scenario) => {
    if (scenario === RANDOM_ORDER_SCENARIO) {
      return hasActionableRandomOrderEstimate(state, depositCapacity, feePolicy);
    }
    if (scenario === SDK_CONVERSION_SCENARIO) {
      return hasBuildableSdkConversionEstimate(state, depositCapacity, false);
    }
    return hasActionableTesterScenarioEstimate(
      state,
      depositCapacity,
      scenario,
      feePolicy,
    );
  });
}

/** Returns true when a scenario has a buildable estimate for the current state. */
export function hasActionableTesterScenarioEstimate(
  state: TesterState,
  depositCapacity: bigint,
  scenario: TesterScenario,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
): boolean {
  if (isSdkConversionScenario(scenario)) {
    return hasBuildableSdkConversionEstimate(state, depositCapacity, false);
  }
  try {
    const effectiveScenario =
      scenario === MULTI_ORDER_LIMIT_ORDERS_SCENARIO
        ? resolveMultiOrderScenario(state, feePolicy)
        : scenario;
    const plan = planTesterTransaction(
      state,
      depositCapacity,
      effectiveScenario,
      feePolicy,
    );
    const orders = plannedRawOrders(plan, effectiveScenario);
    return (
      orders.length > 0 &&
      orders.every((order) => isActionableRawOrder(order, state.system, feePolicy))
    );
  } catch (error) {
    if (error instanceof TesterTerminalError) {
      return false;
    }
    throw error;
  }
}

export {
  buildPlannedRawOrderTransaction,
  estimateRawOrder,
  isActionableEstimatedRawOrder,
  isSdkConversionScenario,
  isUnrepresentableTesterEstimateError,
  plannedRawOrders,
} from "./testerOrderPlanning.ts";
export { planTesterTransaction } from "./testerScenarioPlans.ts";
