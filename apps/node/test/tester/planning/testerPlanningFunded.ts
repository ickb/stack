import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  autoScenarioDraw,
  resolveTesterScenario,
} from "../../../src/tester/planning/testerPlanning.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  testerState,
} from "../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} auto funded scenarios`, () => {
  it("draws only the CKB-side scenarios from a CKB-only balance", () => {
    const draw = new Set(
      autoScenarioDraw(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(4000),
          availableIckbBalance: 0n,
        }),
        ccc.fixedPointFrom(1000),
      ),
    );

    expect([...draw]).toEqual([
      RANDOM_ORDER_SCENARIO,
      SDK_CONVERSION_SCENARIO,
      EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
      MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
      ALL_CKB_LIMIT_ORDER_SCENARIO,
      DUST_CKB_CONVERSION_SCENARIO,
    ]);
    expect(draw.has(ICKB_TO_CKB_LIMIT_ORDER_SCENARIO)).toBe(false);
    expect(draw.has(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO)).toBe(false);
  });

  it("draws only the iCKB-side scenarios from an iCKB-only balance", () => {
    const draw = new Set(
      autoScenarioDraw(
        testerState({
          availableCkbBalance: 0n,
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        ccc.fixedPointFrom(1000),
      ),
    );

    // The composite resolves to two iCKB orders here, so it is affordable too.
    expect([...draw]).toEqual([
      RANDOM_ORDER_SCENARIO,
      SDK_CONVERSION_SCENARIO,
      MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
      DUST_ICKB_CONVERSION_SCENARIO,
    ]);
  });

  it("skips auto selection when only reserve CKB is available", () => {
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(1000),
          availableIckbBalance: 0n,
        }),
        scenario: "auto",
        depositCapacity: 1000n,
        random: () => 0,
      }),
    ).toBeUndefined();
  });
});
