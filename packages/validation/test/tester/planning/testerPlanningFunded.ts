import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { resolveTesterScenario } from "../../../src/tester/index.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  testerState,
} from "../../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} auto funded scenarios`, () => {
  it("resolves CKB-only auto scenarios from funded balances", () => {
    const ckbOnlyState = testerState({
      availableCkbBalance: ccc.fixedPointFrom(4000),
      availableIckbBalance: 0n,
    });
    expect(
      resolveTesterScenario({
        state: ckbOnlyState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0,
      }),
    ).toBe(RANDOM_ORDER_SCENARIO);
    expect(
      resolveTesterScenario({
        state: ckbOnlyState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0.99,
      }),
    ).toBe(SDK_CONVERSION_SCENARIO);
  });

  it("resolves iCKB-only auto scenarios from funded balances", () => {
    const ickbOnlyState = testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    expect(
      resolveTesterScenario({
        state: ickbOnlyState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0,
      }),
    ).toBe(RANDOM_ORDER_SCENARIO);
    expect(
      resolveTesterScenario({
        state: ickbOnlyState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0.5,
      }),
    ).toBe(SDK_CONVERSION_SCENARIO);
    expect(
      resolveTesterScenario({
        state: ickbOnlyState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0.99,
      }),
    ).toBe(BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} auto funded scenarios`, () => {
  it("does not auto-select explicit multi-order scenarios", () => {
    const mixedMultiOrderState = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    const autoSamples = [0, 0.2, 0.4, 0.6, 0.8, 0.99].map((sample) =>
      resolveTesterScenario({
        state: mixedMultiOrderState,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => sample,
      }),
    );
    expect(autoSamples).not.toContain(ALL_CKB_LIMIT_ORDER_SCENARIO);
    expect(autoSamples).not.toContain(ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
    expect(autoSamples).not.toContain(TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO);
    expect(autoSamples).not.toContain(TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO);
    expect(autoSamples).not.toContain(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO);
    expect(autoSamples).not.toContain(DUST_CKB_CONVERSION_SCENARIO);
    expect(autoSamples).not.toContain(DUST_ICKB_CONVERSION_SCENARIO);
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
