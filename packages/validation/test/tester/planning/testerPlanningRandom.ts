import { ccc } from "@ckb-ccc/core";
import { IckbSdk } from "@ickb/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  isBuildableSdkConversionOrder,
  plannedRawOrders,
  sampleRatio,
} from "../../../src/tester/planning/testerOrderPlanning.ts";
import {
  hasActionableTesterScenarioEstimate,
  planTesterTransaction,
  resolveTesterScenario,
} from "../../../src/tester/planning/testerPlanning.ts";
import { hasBuildableSdkConversionEstimate } from "../../../src/tester/planning/testerSdkPlanning.ts";
import {
  CKB_TO_ICKB_DIRECTION,
  ICKB_TO_CKB_DIRECTION,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  SDK_CONVERSION_SCENARIO,
  TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO,
  TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
  orderInfoForEstimate,
  testerState,
} from "../../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} multi-order resolution`, () => {
  it("funds direct SDK conversion at exactly reserve plus deposit capacity", () => {
    const depositCapacity = ccc.fixedPointFrom(1000);
    expect(
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        depositCapacity,
        SDK_CONVERSION_SCENARIO,
      ),
    ).toEqual({
      direction: CKB_TO_ICKB_DIRECTION,
      amount: depositCapacity,
      ckbAmount: depositCapacity,
      udtAmount: 0n,
      orderCount: 1,
    });
    expect(
      hasActionableTesterScenarioEstimate(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        depositCapacity,
        SDK_CONVERSION_SCENARIO,
      ),
    ).toBe(true);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} raw order helpers`, () => {
  it("covers zero amount, split order, SDK conversion, and mixed raw order planning", () => {
    expect(
      plannedRawOrders(
        {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: 0n,
          ckbAmount: 0n,
          udtAmount: 0n,
          orderCount: 1,
        },
        SDK_CONVERSION_SCENARIO,
      ),
    ).toEqual([]);
    expect(
      plannedRawOrders(
        {
          direction: ICKB_TO_CKB_DIRECTION,
          amount: 5n,
          ckbAmount: 0n,
          udtAmount: 5n,
          orderCount: 2,
        },
        TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO,
      ),
    ).toEqual([
      {
        direction: ICKB_TO_CKB_DIRECTION,
        amount: 2n,
        amounts: { ckbValue: 0n, udtValue: 2n },
      },
      {
        direction: ICKB_TO_CKB_DIRECTION,
        amount: 3n,
        amounts: { ckbValue: 0n, udtValue: 3n },
      },
    ]);
    expect(
      plannedRawOrders(
        {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: 7n,
          ckbAmount: 7n,
          udtAmount: 0n,
          orderCount: 1,
        },
        SDK_CONVERSION_SCENARIO,
      ),
    ).toEqual([
      {
        direction: CKB_TO_ICKB_DIRECTION,
        amount: 7n,
        amounts: { ckbValue: 7n, udtValue: 0n },
      },
    ]);
  });
});

describe(`${PLAN_TESTER_TRANSACTION} SDK conversion helper branches`, () => {
  it("covers direct-deposit buildability branches", () => {
    const system = testerState({ availableCkbBalance: 0n }).system;
    const estimate = {
      convertedAmount: 1n,
      ckbFee: 1n,
      info: orderInfoForEstimate(),
      maturity: undefined,
    };

    expect(
      isBuildableSdkConversionOrder({
        plan: {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: ccc.fixedPointFrom(999),
          ckbAmount: ccc.fixedPointFrom(999),
          udtAmount: 0n,
          orderCount: 1,
        },
        order: {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: ccc.fixedPointFrom(999),
          amounts: { ckbValue: ccc.fixedPointFrom(999), udtValue: 0n },
        },
        estimate,
        system,
        depositCapacity: ccc.fixedPointFrom(1000),
        allowDustIckbToCkb: true,
      }),
    ).toBe(false);
    expect(
      isBuildableSdkConversionOrder({
        plan: {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: ccc.fixedPointFrom(1000),
          ckbAmount: ccc.fixedPointFrom(1000),
          udtAmount: 0n,
          orderCount: 1,
        },
        order: {
          direction: CKB_TO_ICKB_DIRECTION,
          amount: ccc.fixedPointFrom(1000),
          amounts: { ckbValue: ccc.fixedPointFrom(1000), udtValue: 0n },
        },
        estimate,
        system,
        depositCapacity: ccc.fixedPointFrom(1000),
        allowDustIckbToCkb: true,
      }),
    ).toBe(true);
  });
});

describe(`${PLAN_TESTER_TRANSACTION} SDK conversion estimate outcomes`, () => {
  it("classifies terminal SDK conversion plans as unbuildable", () => {
    expect(
      hasBuildableSdkConversionEstimate(
        testerState({ availableCkbBalance: 0n, availableIckbBalance: 0n }),
        ccc.fixedPointFrom(1000),
      ),
    ).toBe(false);
    expect(
      hasBuildableSdkConversionEstimate(
        testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) }),
        ccc.fixedPointFrom(1000),
      ),
    ).toBe(true);
  });

  it("throws nonterminal SDK conversion estimator failures", () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockImplementation(() => {
      throw new Error("unexpected estimator failure");
    });
    try {
      expect(() =>
        hasBuildableSdkConversionEstimate(
          testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) }),
          ccc.fixedPointFrom(1000),
        ),
      ).toThrow("unexpected estimator failure");
    } finally {
      estimate.mockRestore();
    }
  });

  it("treats zero converted SDK estimates as unbuildable", () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockReturnValue({
      convertedAmount: 0n,
      ckbFee: 0n,
      info: orderInfoForEstimate(),
      maturity: undefined,
    });
    try {
      expect(
        hasBuildableSdkConversionEstimate(
          testerState({ availableCkbBalance: ccc.fixedPointFrom(4000) }),
          ccc.fixedPointFrom(1000),
        ),
      ).toBe(false);
    } finally {
      estimate.mockRestore();
    }
  });
});
describe(`${PLAN_TESTER_TRANSACTION} random direction sampling`, () => {
  it("can select CKB-to-iCKB when both random directions are funded", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      expect(
        planTesterTransaction(
          testerState({
            availableCkbBalance: ccc.fixedPointFrom(4000),
            availableIckbBalance: ccc.fixedPointFrom(1000),
          }),
          ccc.fixedPointFrom(1000),
          "random-order",
        ),
      ).toMatchObject({ direction: CKB_TO_ICKB_DIRECTION });
    } finally {
      random.mockRestore();
    }
  });
});
describe(`${PLAN_TESTER_TRANSACTION} sampling helpers`, () => {
  it("samples zero from non-positive ratios", () => {
    expect(sampleRatio(0n)).toBe(0n);
    expect(sampleRatio(-1n)).toBe(0n);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} multi-order resolution`, () => {
  it("resolves generic multi-order scenarios to any funded multi-order type", () => {
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(650000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO);
    expect(
      planTesterTransaction(
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(650000),
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        1000n,
        MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      ),
    ).toMatchObject({
      direction: CKB_TO_ICKB_DIRECTION,
      orderCount: 2,
    });
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(650000),
          availableIckbBalance: 0n,
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(TWO_CKB_TO_ICKB_LIMIT_ORDERS_SCENARIO);
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: 0n,
          availableIckbBalance: ccc.fixedPointFrom(200),
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO);
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(3100),
          availableIckbBalance: ccc.fixedPointFrom(200),
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO);
    expect(
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000) + 1n,
          availableIckbBalance: ccc.fixedPointFrom(123),
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toBe(TWO_ICKB_TO_CKB_LIMIT_ORDERS_SCENARIO);
    expect(() =>
      resolveTesterScenario({
        state: testerState({
          availableCkbBalance: ccc.fixedPointFrom(1000),
          availableIckbBalance: 1n,
        }),
        scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
      }),
    ).toThrow("Not enough funds for multi-order limit orders scenario");
    expect(
      resolveTesterScenario({
        state: testerState({ availableCkbBalance: 0n }),
        scenario: SDK_CONVERSION_SCENARIO,
      }),
    ).toBe(SDK_CONVERSION_SCENARIO);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} multi-order resolution`, () => {
  it("checks generic multi-order estimates against the resolved concrete scenario", () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockReturnValue({
      convertedAmount: 1n,
      ckbFee: ccc.fixedPointFrom(1),
      info: orderInfoForEstimate(),
      maturity: 0n,
    });
    try {
      expect(
        hasActionableTesterScenarioEstimate(
          testerState({
            availableCkbBalance: ccc.fixedPointFrom(650000),
            availableIckbBalance: ccc.fixedPointFrom(123),
          }),
          1000n,
          MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
        ),
      ).toBe(true);
      expect(estimate.mock.calls.slice(-2).map((call) => call[0])).toEqual([true, false]);
    } finally {
      estimate.mockRestore();
    }
  });

  it("throws nonterminal multi-order estimator failures", () => {
    const estimate = vi.spyOn(IckbSdk, "estimate").mockImplementation(() => {
      throw new Error("unexpected multi-order estimate failure");
    });
    try {
      expect(() =>
        resolveTesterScenario({
          state: testerState({
            availableCkbBalance: ccc.fixedPointFrom(650000),
            availableIckbBalance: ccc.fixedPointFrom(123),
          }),
          scenario: MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
        }),
      ).toThrow("unexpected multi-order estimate failure");
    } finally {
      estimate.mockRestore();
    }
  });
});
