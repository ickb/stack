import { ccc } from "@ckb-ccc/core";
import { IckbSdk, OrderManager, Ratio } from "@ickb/sdk";

import { describe, expect, it, vi } from "vitest";
import { testerNoActionableAutoScenarioSkip } from "../../../src/tester/evidence/testerEvidence.ts";
import {
  autoScenarioDraw,
  hasActionableTesterScenarioEstimate,
  planTesterTransaction,
  resolveTesterScenario,
} from "../../../src/tester/planning/testerPlanning.ts";
import { TESTER_SCENARIOS } from "../../../src/tester/testerContract.ts";
import {
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  CKB_TO_ICKB_DIRECTION,
  DUST_CKB_CONVERSION_SCENARIO,
  DUST_ICKB_CONVERSION_SCENARIO,
  DUST_ICKB_TO_CKB_NOTICE,
  ESTIMATED_TOO_SMALL_REASON,
  ICKB_TO_CKB_DIRECTION,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  mintedOrder,
  MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO,
  MULTI_ORDER_LIMIT_ORDERS_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  RANDOM_ORDER_SCENARIO,
  SDK_CONVERSION_SCENARIO,
  testerState,
} from "../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} auto scenario selection`, () => {
  it("plans random orders from iCKB only when CKB is below reserve", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(1999),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      const plan = planTesterTransaction(state, 1000n, RANDOM_ORDER_SCENARIO);
      expect(plan).toMatchObject({
        direction: ICKB_TO_CKB_DIRECTION,
        ckbAmount: 0n,
        orderCount: 1,
      });
      expect(plan.amount).toBeGreaterThan(1n << 33n);
      expect(plan.amount).toBeLessThanOrEqual(ccc.fixedPointFrom(123));
      expect(plan.udtAmount).toBe(plan.amount);
    } finally {
      random.mockRestore();
    }
  });

  it("draws a dust order once when only dust and a tiny deposit are affordable, and nothing below that", () => {
    // One shannon above the reserve and the order overhead: only a dust order is affordable.
    const dustOnly = testerState({
      availableCkbBalance: ccc.fixedPointFrom(2000) + 1n,
      availableIckbBalance: 0n,
    });

    const draw = autoScenarioDraw(dustOnly, 1000n);
    expect(
      draw.filter((scenario) => scenario === DUST_CKB_CONVERSION_SCENARIO),
    ).toHaveLength(1);
    expect(draw).not.toContain(RANDOM_ORDER_SCENARIO);
    expect(
      resolveTesterScenario({
        state: dustOnly,
        scenario: "auto",
        depositCapacity: 1000n,
        random: () => (draw.indexOf(DUST_CKB_CONVERSION_SCENARIO) + 0.5) / draw.length,
      }),
    ).toBe(DUST_CKB_CONVERSION_SCENARIO);
    expect(
      resolveTesterScenario({
        state: testerState({ availableCkbBalance: ccc.fixedPointFrom(1000) }),
        scenario: "auto",
        depositCapacity: 1000n,
      }),
    ).toBeUndefined();
  });

  it("weights every funded scenario four to one against a dust scenario", () => {
    const funded = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });

    const draw = autoScenarioDraw(funded, ccc.fixedPointFrom(1000));
    const counts = new Map<string, number>();
    for (const scenario of draw) {
      counts.set(scenario, (counts.get(scenario) ?? 0) + 1);
    }

    expect([...counts.keys()]).toEqual([...TESTER_SCENARIOS]);
    expect(counts.get(MULTI_ORDER_LIMIT_ORDERS_SCENARIO)).toBe(4);
    expect(counts.get(DUST_CKB_CONVERSION_SCENARIO)).toBe(1);
    expect(counts.get(DUST_ICKB_CONVERSION_SCENARIO)).toBe(1);
  });

  it("resolves a drawn composite scenario before planning", () => {
    const funded = testerState({
      availableCkbBalance: ccc.fixedPointFrom(650000),
      plainCkbBalance: ccc.fixedPointFrom(1000),
      availableIckbBalance: ccc.fixedPointFrom(123),
    });
    const draw = autoScenarioDraw(funded, ccc.fixedPointFrom(1000));
    const index = draw.indexOf(MULTI_ORDER_LIMIT_ORDERS_SCENARIO);

    expect(
      resolveTesterScenario({
        state: funded,
        scenario: "auto",
        depositCapacity: ccc.fixedPointFrom(1000),
        random: () => (index + 0.5) / draw.length,
      }),
    ).toBe(MIXED_DIRECTION_LIMIT_ORDERS_SCENARIO);
  });

  it("auto-selects random orders when near-reserve capital can fund actionable iCKB stimulus", () => {
    const liveNearReserveState = testerState({
      availableCkbBalance: 229423868188n,
      availableIckbBalance: 147394003472899n,
      exchangeRatio: Ratio.from({
        ckbScale: 10000000000000000n,
        udtScale: 11845567055823930n,
      }),
      feeRate: 33222n,
    });

    expect(
      resolveTesterScenario({
        state: liveNearReserveState,
        scenario: "auto",
        depositCapacity: 11845567055823n,
        random: () => 0,
      }),
    ).toBe(RANDOM_ORDER_SCENARIO);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} auto scenario selection`, () => {
  it("formats auto with no actionable scenario as a nonterminal estimate skip", () => {
    expect(testerNoActionableAutoScenarioSkip()).toEqual({
      reason: ESTIMATED_TOO_SMALL_REASON,
      requestedTesterScenario: "auto",
      attemptedTesterScenarios: [...TESTER_SCENARIOS],
    });
  });

  it("does not auto-select SDK iCKB dust conversions", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(1000),
      availableIckbBalance: 1000000n,
      exchangeRatio: Ratio.from({
        ckbScale: 10000000000000000n,
        udtScale: 11850413696044750n,
      }),
      feeRate: 33222n,
    });

    expect(
      IckbSdk.estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: 1000000n }, state.system)
        ?.notice?.kind,
    ).toBe(DUST_ICKB_TO_CKB_NOTICE);
    expect(autoScenarioDraw(state, ccc.fixedPointFrom(1000))).not.toContain(
      SDK_CONVERSION_SCENARIO,
    );
    expect(resolveTesterScenario({ state, scenario: SDK_CONVERSION_SCENARIO })).toBe(
      SDK_CONVERSION_SCENARIO,
    );
  });
});
describe(`${PLAN_TESTER_TRANSACTION} random order amounts`, () => {
  it("can auto-select full-consumption bounded iCKB orders below partial matcher minimums", () => {
    const draw = autoScenarioDraw(
      testerState({
        availableCkbBalance: 0n,
        availableIckbBalance: ccc.fixedPointFrom(1),
      }),
      ccc.fixedPointFrom(1000),
      { fee: 1n, feeBase: 1000n },
    );

    expect(draw).toContain(BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
    expect(draw).toContain(ICKB_TO_CKB_LIMIT_ORDER_SCENARIO);
  });

  it("classifies full-consumption bounded iCKB orders below partial matcher minimums as actionable", () => {
    expect(
      hasActionableTesterScenarioEstimate(
        testerState({
          availableCkbBalance: 0n,
          availableIckbBalance: ccc.fixedPointFrom(1),
        }),
        ccc.fixedPointFrom(1000),
        BOUNDED_ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
        { fee: 1n, feeBase: 1000n },
      ),
    ).toBe(true);
  });
});
describe(`${PLAN_TESTER_TRANSACTION} random order amounts`, () => {
  it("samples random order amounts that clear the live fee threshold", () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(4000),
      availableIckbBalance: 0n,
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const plan = planTesterTransaction(
        state,
        ccc.fixedPointFrom(1000),
        RANDOM_ORDER_SCENARIO,
      );
      expect(plan.direction).toBe(CKB_TO_ICKB_DIRECTION);
      expect(plan.amount).toBe(ccc.fixedPointFrom(10));
      expect(plan.amount).toBeLessThanOrEqual(ccc.fixedPointFrom(1000));
      expect(plan.ckbAmount).toBe(plan.amount);
    } finally {
      random.mockRestore();
    }
  });

  it("reports incomplete exact search for a large atomic order domain", async () => {
    const state = testerState({
      availableCkbBalance: ccc.fixedPointFrom(4000),
      availableIckbBalance: 0n,
    });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const plan = planTesterTransaction(
        state,
        ccc.fixedPointFrom(1000),
        RANDOM_ORDER_SCENARIO,
      );
      const estimate = IckbSdk.estimate(
        true,
        { ckbValue: plan.ckbAmount, udtValue: 0n },
        state.system,
      );
      const order = await mintedOrder(estimate.info, {
        ckbValue: plan.ckbAmount,
        udtValue: 0n,
      });

      expect(plan.amount).toBeLessThan(estimate.info.getCkbMinMatch());
      expect(
        OrderManager.bestMatch(
          [order],
          { ckbValue: 0n, udtValue: estimate.convertedAmount },
          state.system.exchangeRatio,
          { feeRate: state.system.feeRate, maxPartials: 1 },
        ),
      ).toMatchObject({ kind: "incomplete" });
    } finally {
      random.mockRestore();
    }
  });
});
