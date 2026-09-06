import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  autoScenarioDraw,
  hasActionableTesterScenarioEstimate,
  planTesterTransaction,
  resolveTesterScenario,
} from "../../../src/tester/planning/testerPlanning.ts";
import { TesterTerminalError } from "../../../src/tester/runtime/testerTypes.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB_DIRECTION,
  EXTRA_LARGE_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_DIRECTION,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  testerState,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
} from "../support/tester/index.ts";

describe(PLAN_TESTER_TRANSACTION, () => {
  it("does not silently downsize extra-large limit orders", () => {
    const depositCapacity = 1000n;
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(3000) + 2000n,
      plainCkbBalance: ccc.fixedPointFrom(1000),
    });

    expect(
      planTesterTransaction(state, depositCapacity, EXTRA_LARGE_LIMIT_ORDER_SCENARIO),
    ).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: 2000n,
      ckbAmount: 2000n,
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("fails extra-large limit orders when funding cannot preserve reserve and overhead", () => {
    const depositCapacity = 1000n;
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000) + 1999n,
    });

    expect(() =>
      planTesterTransaction(state, depositCapacity, EXTRA_LARGE_LIMIT_ORDER_SCENARIO),
    ).toThrow("Not enough CKB for extra-large limit order scenario");
    expect(() =>
      planTesterTransaction(state, depositCapacity, EXTRA_LARGE_LIMIT_ORDER_SCENARIO),
    ).toThrow(TesterTerminalError);
  });

  it("spends all available CKB except reserve and overhead for all-CKB limit orders", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
    });

    expect(planTesterTransaction(state, 1000n, ALL_CKB_LIMIT_ORDER_SCENARIO)).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: ccc.fixedPointFrom(648000),
      ckbAmount: ccc.fixedPointFrom(648000),
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("plans two CKB-to-iCKB limit orders with all available CKB except reserve and overhead", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
    });

    expect(
      planTesterTransaction(state, 1000n, TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO),
    ).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: ccc.fixedPointFrom(648000),
      ckbAmount: ccc.fixedPointFrom(648000),
      udtAmount: 0n,
      orderCount: 2,
    });
  });

  it("fails two CKB-to-iCKB limit orders when funding cannot preserve reserve and overhead", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000),
    });

    expect(() =>
      planTesterTransaction(state, 1000n, TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO),
    ).toThrow("Not enough CKB for two CKB-to-iCKB limit orders scenario");
    expect(() =>
      planTesterTransaction(state, 1000n, TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO),
    ).toThrow(TesterTerminalError);
  });

  it("fails all-CKB limit orders when funding cannot preserve reserve and overhead", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000),
    });

    expect(() =>
      planTesterTransaction(state, 1000n, ALL_CKB_LIMIT_ORDER_SCENARIO),
    ).toThrow("Not enough CKB for all-CKB limit order scenario");
    expect(() =>
      planTesterTransaction(state, 1000n, ALL_CKB_LIMIT_ORDER_SCENARIO),
    ).toThrow(TesterTerminalError);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} projected balances`, () => {
  it("plans CKB-spending orders from collectable available CKB", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
      availableIckbBalance: 0n,
    });

    expect(
      planTesterTransaction(state, 1000n, ALL_CKB_LIMIT_ORDER_SCENARIO),
    ).toMatchObject({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: ccc.fixedPointFrom(648000),
    });
    expect(
      hasActionableTesterScenarioEstimate(
        state,
        ccc.fixedPointFrom(1000),
        RANDOM_ORDER_SCENARIO,
      ),
    ).toBe(true);
    expect(
      resolveTesterScenario({
        state,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => 0,
      }),
    ).toBe(RANDOM_ORDER_SCENARIO);
  });

  it("spends all available iCKB for iCKB-to-CKB limit orders", () => {
    const state = testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: ccc.fixedPointFrom(123),
    });

    expect(planTesterTransaction(state, 1000n, ICKB_TO_CKB_LIMIT_ORDER_SCENARIO)).toEqual(
      {
        direction: ICKB_TO_CKB_DIRECTION,
        amount: ccc.fixedPointFrom(123),
        ckbAmount: 0n,
        udtAmount: ccc.fixedPointFrom(123),
        orderCount: 1,
      },
    );
  });
});
describe(`${PLAN_TESTER_TRANSACTION} iCKB limit orders`, () => {
  it("caps bounded iCKB-to-CKB limit orders at one deposit-cap unit", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2500),
      availableIckbBalance: ccc.fixedPointFrom(123456),
    });

    expect(
      planTesterTransaction(
        state,
        ccc.fixedPointFrom(1000),
        BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toEqual({
      direction: ICKB_TO_CKB_DIRECTION,
      amount: ccc.fixedPointFrom(100000),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(100000),
      orderCount: 1,
    });
    expect(
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2500),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        ccc.fixedPointFrom(1000),
        BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toMatchObject({
      amount: ccc.fixedPointFrom(123),
      udtAmount: ccc.fixedPointFrom(123),
    });
  });

  it("plans two iCKB-to-CKB limit orders with all available iCKB", () => {
    const state = testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: ccc.fixedPointFrom(123),
    });

    expect(
      planTesterTransaction(state, 1000n, TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO),
    ).toEqual({
      direction: ICKB_TO_CKB_DIRECTION,
      amount: ccc.fixedPointFrom(123),
      ckbAmount: 0n,
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 2,
    });
  });

  it("fails two iCKB-to-CKB limit orders when funding cannot create two orders", () => {
    const state = testerState({
      availableCkbBalance: 0n,
      availableIckbBalance: 1n,
    });

    expect(() =>
      planTesterTransaction(state, 1000n, TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO),
    ).toThrow("Not enough iCKB for two iCKB-to-CKB limit orders scenario");
    expect(() =>
      planTesterTransaction(state, 1000n, TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO),
    ).toThrow(TesterTerminalError);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} SDK conversion scenarios`, () => {
  it("plans SDK conversion scenarios as full deposit-cap conversions", () => {
    const ckbState = testerState({
      availableCkbBalance: ccc.fixedPointFrom(3000) + 1000n,
      plainCkbBalance: ccc.fixedPointFrom(1000),
    });
    expect(planTesterTransaction(ckbState, 1000n, SDK_CONVERSION_SCENARIO)).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: 1000n,
      ckbAmount: 1000n,
      udtAmount: 0n,
      orderCount: 1,
    });
  });

  it("does not reserve raw-order overhead for direct SDK CKB deposits", () => {
    const ckbState = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000) + 1000n,
      plainCkbBalance: ccc.fixedPointFrom(1000),
    });

    expect(planTesterTransaction(ckbState, 1000n, SDK_CONVERSION_SCENARIO)).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: 1000n,
      ckbAmount: 1000n,
      udtAmount: 0n,
      orderCount: 1,
    });
    expect(
      hasActionableTesterScenarioEstimate(ckbState, 1000n, SDK_CONVERSION_SCENARIO),
    ).toBe(true);
    expect(autoScenarioDraw(ckbState, 1000n)).toContain(SDK_CONVERSION_SCENARIO);
  });
});
