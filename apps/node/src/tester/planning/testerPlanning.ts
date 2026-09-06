import type { TesterState } from "../runtime/runtime.ts";
import {
  DEFAULT_TESTER_FEE_POLICY,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_TESTER_SCENARIOS,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TESTER_SCENARIOS,
  TesterTerminalError,
  type TesterFeePolicy,
  type TesterScenario,
  type TesterScenarioSelection,
} from "../runtime/testerTypes.ts";
import { randomTesterScenario } from "./testerConfig.ts";
import {
  ckbSpendingOrderBudget,
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

/** Each funded scenario appears this many times in the draw for every one time a dust scenario does. */
const FUNDED_DRAW_WEIGHT = 4;

/**
 * Resolves a configured scenario into a concrete scenario when possible.
 *
 * @remarks `auto` draws among every scenario the account can currently afford (decisions
 * amendment 43), with the dust scenarios at a lower weight since their order is rejected
 * on purpose; a composite draw resolves like an explicit composite request.
 */
export function resolveTesterScenario({
  state,
  scenario,
  feePolicy = DEFAULT_TESTER_FEE_POLICY,
  depositCapacity = 0n,
  random = Math.random,
}: ResolveTesterScenarioOptions): TesterScenario | undefined {
  let drawn: TesterScenario;
  if (scenario === "auto") {
    const draw = autoScenarioDraw(state, depositCapacity, feePolicy);
    if (draw.length === 0) {
      return undefined;
    }
    drawn = randomTesterScenario(random, draw);
  } else {
    drawn = scenario;
  }
  return drawn === MULTI_ORDER_LIMIT_ORDERS_SCENARIO
    ? resolveMultiOrderScenario(state, feePolicy)
    : drawn;
}

/** The weighted list `auto` draws from: every affordable scenario, dust ones once each. */
export function autoScenarioDraw(
  state: TesterState,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy = DEFAULT_TESTER_FEE_POLICY,
): TesterScenario[] {
  return TESTER_SCENARIOS.flatMap((scenario): TesterScenario[] => {
    if (isDustScenario(scenario)) {
      return isDrawableDustScenario(state, scenario) ? [scenario] : [];
    }
    return isFundedTesterScenario(state, depositCapacity, feePolicy, scenario)
      ? Array.from({ length: FUNDED_DRAW_WEIGHT }, () => scenario)
      : [];
  });
}

const DUST_SCENARIO_NAMES: ReadonlySet<TesterScenario> = new Set(DUST_TESTER_SCENARIOS);

function isDustScenario(scenario: TesterScenario): boolean {
  return DUST_SCENARIO_NAMES.has(scenario);
}

/** A dust scenario needs only the shannon it spends; its order is rejected later on purpose. */
function isDrawableDustScenario(state: TesterState, scenario: TesterScenario): boolean {
  const spendable =
    scenario === DUST_CKB_CONVERSION_SCENARIO
      ? ckbSpendingOrderBudget(state.availableCkbBalance)
      : state.availableIckbBalance;
  return spendable >= 1n;
}

function isFundedTesterScenario(
  state: TesterState,
  depositCapacity: bigint,
  feePolicy: TesterFeePolicy,
  scenario: TesterScenario,
): boolean {
  if (scenario === RANDOM_ORDER_SCENARIO) {
    return hasActionableRandomOrderEstimate(state, depositCapacity, feePolicy);
  }
  if (scenario === SDK_CONVERSION_SCENARIO) {
    return hasBuildableSdkConversionEstimate(state, depositCapacity, false);
  }
  return hasActionableTesterScenarioEstimate(state, depositCapacity, scenario, feePolicy);
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
  plannedRawOrders,
} from "./testerOrderPlanning.ts";
export { planTesterTransaction } from "./testerScenarioPlans.ts";
