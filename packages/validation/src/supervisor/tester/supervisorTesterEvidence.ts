import {
  CKB_TO_ICKB,
  GIVE_CKB_FIELD,
  GIVE_ICKB_FIELD,
  ICKB_TO_CKB,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  RANDOM_ORDER_SCENARIO,
  TAKE_CKB_FIELD,
  TAKE_ICKB_FIELD,
  TESTER_FEE_FIELD,
  TESTER_SCENARIOS,
  TESTER_SCENARIO_FIELD,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  isIckbToCkbTesterScenario,
  isSdkConversionTesterScenario,
  type TesterDirection,
  type TesterScenario,
} from "../runtime/shared/supervisorConstants.ts";
import {
  isRecord,
  numberField,
  recordField,
  stringField,
} from "../runtime/shared/supervisorEvidence.ts";
import type {
  TesterEvidenceExpectation,
  TesterOrderEvidence,
  TesterOrderSummary,
} from "../runtime/shared/supervisorTypes.ts";

const TESTER_MULTI_ORDER_VALIDATORS = new Map<
  TesterScenario,
  (actions: Record<string, unknown>, scenario: TesterScenario) => string | undefined
>([
  [
    TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
    (actions, scenario): string | undefined =>
      validateMultiOrders(actions, 2, scenario, CKB_TO_ICKB),
  ],
  [
    TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
    (actions, scenario): string | undefined =>
      validateMultiOrders(actions, 2, scenario, ICKB_TO_CKB),
  ],
  [MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO, validateMixedDirectionOrders],
]);

export function testerOrderEvidence(
  actions: Record<string, unknown> | undefined,
): TesterOrderEvidence | undefined {
  if (actions === undefined) {
    return undefined;
  }
  const orders = testerOrderSummaries(actions);
  if (orders === undefined || orders.length === 0) {
    return undefined;
  }
  return {
    ...(stringField(actions, "requestedTesterScenario") === undefined
      ? {}
      : {
          requestedTesterScenario: stringField(actions, "requestedTesterScenario"),
        }),
    ...(stringField(actions, TESTER_SCENARIO_FIELD) === undefined
      ? {}
      : { testerScenario: stringField(actions, TESTER_SCENARIO_FIELD) }),
    orderCount: numberField(actions, "orderCount") ?? orders.length,
    ...(numberField(actions, "collectedOrders") === undefined
      ? {}
      : { collectedOrders: numberField(actions, "collectedOrders") }),
    ...(numberField(actions, "cancelledOrders") === undefined
      ? {}
      : { cancelledOrders: numberField(actions, "cancelledOrders") }),
    orders,
  };
}

function testerOrderSummaries(
  actions: Record<string, unknown>,
): TesterOrderSummary[] | undefined {
  const newOrders = arrayField(actions, "newOrders");
  if (newOrders !== undefined) {
    const summaries = new Array<TesterOrderSummary>();
    for (const order of newOrders) {
      const summary = testerOrderSummary(order);
      if (summary === undefined) {
        return undefined;
      }
      summaries.push(summary);
    }
    return summaries;
  }
  const newOrder = recordField(actions, "newOrder");
  const summary = testerOrderSummary(newOrder);
  return summary === undefined ? [] : [summary];
}

function testerOrderSummary(order: unknown): TesterOrderSummary | undefined {
  if (!isRecord(order)) {
    return undefined;
  }
  const giveCkb = stringField(order, GIVE_CKB_FIELD);
  const takeIckb = stringField(order, TAKE_ICKB_FIELD);
  const giveIckb = stringField(order, GIVE_ICKB_FIELD);
  const takeCkb = stringField(order, TAKE_CKB_FIELD);
  const direction = orderDirection(order);
  if (direction === undefined) {
    return undefined;
  }
  const fee = stringField(order, TESTER_FEE_FIELD);
  const feeNumerator = stringField(order, "feeNumerator");
  const feeBase = stringField(order, "feeBase");
  const summary: TesterOrderSummary = {
    direction,
    dust: giveCkb === "0.00000001" || giveIckb === "0.00000001",
  };
  setOptional(summary, GIVE_CKB_FIELD, giveCkb);
  setOptional(summary, TAKE_ICKB_FIELD, takeIckb);
  setOptional(summary, GIVE_ICKB_FIELD, giveIckb);
  setOptional(summary, TAKE_CKB_FIELD, takeCkb);
  setOptional(summary, TESTER_FEE_FIELD, fee);
  setOptional(summary, "feeNumerator", feeNumerator);
  setOptional(summary, "feeBase", feeBase);
  return summary;
}

function setOptional<T extends object, K extends keyof T>(
  record: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    Object.assign(record, { [key]: value });
  }
}

export function validateTesterEvidenceExpectation(
  actions: Record<string, unknown> | undefined,
  expectation: TesterEvidenceExpectation | undefined,
): string | undefined {
  if (expectation === undefined) {
    return undefined;
  }
  if (actions === undefined) {
    return `tester committed tx without actions for expected scenario ${expectation.scenario}`;
  }
  const loggedScenario = stringField(actions, TESTER_SCENARIO_FIELD);
  if (expectation.scenario === MULTI_ORDER_LIMIT_ORDERS_SCENARIO) {
    return validateAnyMultiOrders(actions, expectation.scenario);
  }
  if (loggedScenario !== expectation.scenario) {
    return `tester committed tx for scenario ${loggedScenario ?? "unknown"}, expected ${expectation.scenario}`;
  }
  return validateExpectedTesterScenarioActions(actions, expectation.scenario);
}

function validateExpectedTesterScenarioActions(
  actions: Record<string, unknown>,
  scenario: TesterScenario,
): string | undefined {
  if (isSdkConversionTesterScenario(scenario)) {
    return recordField(actions, "conversion") === undefined
      ? `tester scenario ${scenario} committed without conversion evidence`
      : undefined;
  }
  const validateMultiOrder = TESTER_MULTI_ORDER_VALIDATORS.get(scenario);
  if (validateMultiOrder !== undefined) {
    return validateMultiOrder(actions, scenario);
  }
  const newOrder = recordField(actions, "newOrder");
  if (newOrder === undefined) {
    return `tester scenario ${scenario} committed without new order evidence`;
  }
  if (scenario === RANDOM_ORDER_SCENARIO) {
    return orderDirection(newOrder) !== undefined
      ? undefined
      : "tester scenario random-order committed with wrong order direction evidence";
  }
  return requireOrderDirection(
    scenario,
    newOrder,
    isIckbToCkbTesterScenario(scenario) ? ICKB_TO_CKB : CKB_TO_ICKB,
  );
}

function validateAnyMultiOrders(
  actions: Record<string, unknown>,
  scenario: TesterScenario,
): string | undefined {
  const loggedScenario = stringField(actions, TESTER_SCENARIO_FIELD);
  const selectedScenario = TESTER_SCENARIOS.find(
    (candidate) => candidate === loggedScenario,
  );
  const validateMultiOrder =
    selectedScenario === undefined
      ? undefined
      : TESTER_MULTI_ORDER_VALIDATORS.get(selectedScenario);
  if (validateMultiOrder !== undefined) {
    return validateMultiOrder(actions, scenario);
  }
  return `tester scenario ${scenario} committed with non-multi-order selected scenario evidence`;
}

function validateMultiOrders(
  actions: Record<string, unknown>,
  expectedCount: number,
  scenario: TesterScenario,
  expectedDirection: TesterDirection,
): string | undefined {
  const newOrders = arrayField(actions, "newOrders");
  if (newOrders?.length !== expectedCount) {
    return `tester scenario ${scenario} committed without ${String(expectedCount)} new order evidence entries`;
  }
  if (numberField(actions, "orderCount") !== expectedCount) {
    return `tester scenario ${scenario} committed with wrong order count evidence`;
  }
  return newOrders.every((order) => orderDirection(order) === expectedDirection)
    ? undefined
    : `tester scenario ${scenario} committed with wrong order direction evidence`;
}

function validateMixedDirectionOrders(
  actions: Record<string, unknown>,
  scenario: TesterScenario,
): string | undefined {
  const newOrders = arrayField(actions, "newOrders");
  if (newOrders?.length !== 2) {
    return `tester scenario ${scenario} committed without 2 new order evidence entries`;
  }
  if (numberField(actions, "orderCount") !== 2) {
    return `tester scenario ${scenario} committed with wrong order count evidence`;
  }
  const directions = new Set(newOrders.map(orderDirection));
  return directions.has(CKB_TO_ICKB) && directions.has(ICKB_TO_CKB)
    ? undefined
    : `tester scenario ${scenario} committed without mixed order direction evidence`;
}

function requireOrderDirection(
  scenario: TesterScenario,
  newOrder: Record<string, unknown>,
  expectedDirection: TesterDirection,
): string | undefined {
  if (orderDirection(newOrder) === expectedDirection) {
    return undefined;
  }
  return `tester scenario ${scenario} committed with wrong order direction evidence`;
}

function orderDirection(order: unknown): TesterDirection | undefined {
  if (!isRecord(order)) {
    return undefined;
  }
  const ckbToIckb = hasOrderFields(order, GIVE_CKB_FIELD, TAKE_ICKB_FIELD);
  const ickbToCkb = hasOrderFields(order, GIVE_ICKB_FIELD, TAKE_CKB_FIELD);
  if (ckbToIckb === ickbToCkb) {
    return undefined;
  }
  return ckbToIckb ? CKB_TO_ICKB : ICKB_TO_CKB;
}

function hasOrderFields(
  newOrder: Record<string, unknown>,
  giveField: string,
  takeField: string,
): boolean {
  return (
    typeof newOrder[giveField] === "string" && typeof newOrder[takeField] === "string"
  );
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? value : undefined;
}
