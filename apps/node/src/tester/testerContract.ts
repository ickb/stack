/** Tester scenario and fee contracts. */

export const RANDOM_ORDER_SCENARIO = "random-order";
export const SDK_CONVERSION_SCENARIO = "sdk-conversion";
export const EXTRA_LARGE_LIMIT_ORDER_SCENARIO = "extra-large-limit-order";
export const MULTI_ORDER_LIMIT_ORDERS_SCENARIO = "multi-order-limit-orders";
export const TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO = "two-ckb-to-ickb-limit-orders";
export const ALL_CKB_LIMIT_ORDER_SCENARIO = "all-ckb-limit-order";
export const ICKB_TO_CKB_LIMIT_ORDER_SCENARIO = "ickb-to-ckb-limit-order";
export const BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO = "bounded-ickb-to-ckb-limit-order";
export const TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO = "two-ickb-to-ckb-limit-orders";
export const MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO = "mixed-direction-limit-orders";
export const DUST_CKB_CONVERSION_SCENARIO = "dust-ckb-conversion";
export const DUST_ICKB_CONVERSION_SCENARIO = "dust-ickb-conversion";

export const TESTER_SCENARIOS = [
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
] as const;

export type TesterScenario = (typeof TESTER_SCENARIOS)[number];

export const AUTO_TESTER_SCENARIO = "auto";
export type TesterScenarioSelection = TesterScenario | typeof AUTO_TESTER_SCENARIO;

export const TESTER_SCENARIO_SELECTIONS = [
  AUTO_TESTER_SCENARIO,
  ...TESTER_SCENARIOS,
] as const;

const TESTER_SCENARIO_SELECTION_VALUES: ReadonlySet<string> = new Set<string>(
  TESTER_SCENARIO_SELECTIONS,
);

/** Scenarios whose order is rejected on purpose; `auto` draws them at a lower weight. */
export const DUST_TESTER_SCENARIOS = [
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
] as const satisfies readonly TesterScenario[];

export const MULTI_ORDER_SCENARIOS = [
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
] as const satisfies readonly TesterScenario[];

const TESTER_FEE = 1n;
const TESTER_FEE_BASE = 100000n;
export const MAX_TESTER_FEE_BASE = 1000000n;

/** Fee policy used when estimating raw tester orders. */
export interface TesterFeePolicy {
  /** Fee numerator. */
  readonly fee: bigint;

  /** Fee denominator. */
  readonly feeBase: bigint;
}

export const DEFAULT_TESTER_FEE_POLICY: TesterFeePolicy = {
  fee: TESTER_FEE,
  feeBase: TESTER_FEE_BASE,
};

/** Direction used by tester raw-order and SDK-conversion scenarios. */
export type TesterDirection = "ckb-to-ickb" | "ickb-to-ckb";

export const CKB_TO_ICKB: TesterDirection = "ckb-to-ickb";
export const ICKB_TO_CKB: TesterDirection = "ickb-to-ckb";

export function isTesterScenarioSelection(
  value: string,
): value is TesterScenarioSelection {
  return TESTER_SCENARIO_SELECTION_VALUES.has(value);
}
