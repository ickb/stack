import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { planTesterTransaction } from "../../../src/tester/planning/testerPlanning.ts";
import { TesterTerminalError } from "../../../src/tester/runtime/testerTypes.ts";
import {
  CKB_TO_ICKB_DIRECTION,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  ICKB_TO_CKB_DIRECTION,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  testerState,
} from "../../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} mixed-direction scenarios`, () => {
  it("plans mixed-direction limit orders with available CKB and iCKB", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });

    expect(
      planTesterTransaction(state, 1000n, MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO),
    ).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: ccc.fixedPointFrom(648123),
      ckbAmount: ccc.fixedPointFrom(648000),
      udtAmount: ccc.fixedPointFrom(123),
      orderCount: 2,
    });
  });

  it("fails mixed-direction limit orders when either side is unavailable", () => {
    expect(() =>
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        1000n,
        MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
      ),
    ).toThrow("Not enough CKB for mixed-direction limit orders scenario");
    expect(() =>
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(650000),
          availableIckbBalance: 0n,
        }),
        1000n,
        MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
      ),
    ).toThrow("Not enough iCKB for mixed-direction limit orders scenario");
    expect(() =>
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        1000n,
        MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
      ),
    ).toThrow(TesterTerminalError);
  });
});

describe(`${PLAN_TESTER_TRANSACTION} dust conversion scenarios`, () => {
  it("creates dust conversion scenarios with normal fee handling", () => {
    expect(
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(3000),
          plainCkbBalance: ccc.fixedPointFrom(1000),
        }),
        1000n,
        DUST_CKB_CONVERSION_SCENARIO,
      ),
    ).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: 1n,
      ckbAmount: 1n,
      udtAmount: 0n,
      orderCount: 1,
    });
    expect(
      planTesterTransaction(
        testerState({ availableCkbBalance: 0n, availableIckbBalance: 10n }),
        1000n,
        DUST_ICKB_CONVERSION_SCENARIO,
      ),
    ).toEqual({
      direction: ICKB_TO_CKB_DIRECTION,
      amount: 1n,
      ckbAmount: 0n,
      udtAmount: 1n,
      orderCount: 1,
    });
    expect(() =>
      planTesterTransaction(
        testerState({ availableCkbBalance: ccc.fixedPointFrom(1000) }),
        1000n,
        DUST_CKB_CONVERSION_SCENARIO,
      ),
    ).toThrow("Not enough CKB for dust CKB conversion scenario");
    expect(() =>
      planTesterTransaction(
        testerState({ availableCkbBalance: 0n, availableIckbBalance: 0n }),
        1000n,
        DUST_ICKB_CONVERSION_SCENARIO,
      ),
    ).toThrow("Not enough iCKB for dust iCKB conversion scenario");
  });
});
