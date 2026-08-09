import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import type { BestMatchContext } from "../../src/matching/order_match_context.ts";
import { searchBestMatch } from "../../src/matching/order_match_search.ts";
import { OrderMatcher } from "../../src/matching/order_matcher.ts";
import type { OrderCell } from "../../src/model/cells.ts";
import { Info } from "../../src/model/info.ts";
import { OrderManager, type Match } from "../../src/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { makeOrderCell } from "./support/order_order_helpers.ts";

describe(ORDER_MATCHER_SUITE, () => {
  it("steps CKB-to-UDT orders in the UDT the matcher spends", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 100n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 2n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("51"),
        index: 0n,
      },
    });
    const ckbStep = 3n;
    const udtStep = 3n;

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: 0n,
        udtValue: udtStep,
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ckbStep,
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeGreaterThan(0n);
    expect(match.udtDelta).toBeLessThan(0n);
    expect(-match.udtDelta).toBeLessThanOrEqual(udtStep);
    expect(match.diagnostics?.ckbAllowanceStep).toBe(ckbStep);
    expect(match.diagnostics?.udtAllowanceStep).toBe(udtStep);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("steps UDT-to-CKB orders in the CKB the matcher spends", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: ccc.fixedPointFrom(100_000),
      info: Info.create(false, { ckbScale: 200_000n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("52"),
        index: 0n,
      },
    });
    const ckbAllowance = 100n;

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: ckbAllowance,
        udtValue: 0n,
      },
      {
        ckbScale: 100_000n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: 100_000n,
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeLessThan(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
    expect(-match.ckbDelta).toBeLessThanOrEqual(ckbAllowance);
    expect(match.diagnostics?.ckbAllowanceStep).toBe(100_000n);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("leaves fee room when probing a below-step CKB allowance", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: ccc.fixedPointFrom(100_000),
      info: Info.create(false, { ckbScale: 200_000n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("53"),
        index: 0n,
      },
    });
    const ckbAllowance = 1000n;

    const { match } = OrderManager.bestMatch(
      [resolvedOrderGroup(order)],
      {
        ckbValue: ckbAllowance,
        udtValue: 0n,
      },
      {
        ckbScale: 100_000n,
        udtScale: 1n,
      },
      {
        feeRate: 1000n,
        ckbAllowanceStep: 100_000n,
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(-match.ckbDelta + (match.diagnostics?.ckbMiningFee ?? 0n)).toBeLessThanOrEqual(
      ckbAllowance,
    );
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("uses CKB gained from one side to probe a below-step match on the other side", () => {
    const ckbToUdt = makeOrderCell({
      ckbUnoccupied: 50n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 50n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("54"),
        index: 0n,
      },
    });
    const udtToCkb = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: 100n,
      info: Info.create(false, { ckbScale: 3n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("34"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("55"),
        index: 0n,
      },
    });
    const initialUdt = 1n;

    const { match } = OrderManager.bestMatch(
      resolvedOrderGroups([ckbToUdt, udtToCkb]),
      {
        ckbValue: 0n,
        udtValue: initialUdt,
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1000n,
      },
    );

    const fee = match.diagnostics?.ckbMiningFee ?? 0n;
    expect(
      match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()),
    ).toEqual([ckbToUdt.cell.outPoint.toHex(), udtToCkb.cell.outPoint.toHex()]);
    expect(match.ckbDelta - fee * BigInt(match.partials.length)).toBeGreaterThanOrEqual(
      0n,
    );
    expect(initialUdt + match.udtDelta).toBeGreaterThanOrEqual(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("uses UDT gained from one side to probe a below-step match on the other side", () => {
    const udtToCkb = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: 50n,
      info: Info.create(false, { ckbScale: 50n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("56"),
        index: 0n,
      },
    });
    const ckbToUdt = makeOrderCell({
      ckbUnoccupied: 100n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 3n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("34"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("57"),
        index: 0n,
      },
    });
    const initialCkb = 1n;

    const { match } = OrderManager.bestMatch(
      resolvedOrderGroups([udtToCkb, ckbToUdt]),
      {
        ckbValue: initialCkb,
        udtValue: 0n,
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1000n,
      },
    );

    const fee = match.diagnostics?.ckbMiningFee ?? 0n;
    expect(
      match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()),
    ).toEqual([ckbToUdt.cell.outPoint.toHex(), udtToCkb.cell.outPoint.toHex()]);
    expect(
      initialCkb + match.ckbDelta - fee * BigInt(match.partials.length),
    ).toBeGreaterThanOrEqual(0n);
    expect(match.udtDelta).toBeGreaterThanOrEqual(0n);
    expect(match.ckbDelta).toBeGreaterThan(0n);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("continues probing budget extensions after an empty first probe", () => {
    const emptyProbe = makeOrderCell({
      ckbUnoccupied: 100n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 40),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("35"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("58"),
        index: 0n,
      },
    });
    const ckbToUdt = makeOrderCell({
      ckbUnoccupied: 100n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 3n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("36"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("59"),
        index: 0n,
      },
    });
    const udtToCkb = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: 50n,
      info: Info.create(false, { ckbScale: 50n, udtScale: 1n }, 0),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("37"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("5a"),
        index: 0n,
      },
    });

    const { match } = OrderManager.bestMatch(
      resolvedOrderGroups([emptyProbe, ckbToUdt, udtToCkb]),
      {
        ckbValue: 1n,
        udtValue: 0n,
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1000n,
      },
    );

    expect(
      match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()),
    ).toEqual([ckbToUdt.cell.outPoint.toHex(), udtToCkb.cell.outPoint.toHex()]);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("skips empty budget-extension probes before trying the next matcher", () => {
    const emptyProbe = budgetExtensionProbe("38", "5b");
    const filledProbe = budgetExtensionProbe("39", "5c");
    const filledGroup = resolvedOrderGroup(filledProbe);
    const emptyMatcher = budgetExtensionMatcher(emptyProbe);
    const filledMatcher = budgetExtensionMatcher(filledProbe);
    emptyMatcher.match = (): Match => ({ ckbDelta: 0n, udtDelta: 0n, partials: [] });
    filledMatcher.match = (): Match => ({
      ckbDelta: 2n,
      udtDelta: -1n,
      partials: [{ group: filledGroup, ckbOut: 1n, udtOut: 0n }],
    });

    const { match } = searchBestMatch(
      budgetExtensionContext(emptyMatcher, filledMatcher),
    );

    expect(
      match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()),
    ).toEqual([filledProbe.cell.outPoint.toHex()]);
  });

  it("returns before the first feasible cross candidate beyond budget", () => {
    const c2u = zeroAllowanceMatcher(budgetExtensionProbe("3a", "5d"), true);
    const u2c = zeroAllowanceMatcher(budgetExtensionProbe("3b", "5e"), false);

    const context = boundedSearchContext([c2u], [u2c], 4, { ckbValue: 0n, udtValue: 0n });
    context.ckbAllowanceStep = 1n;
    context.udtAllowanceStep = 1n;

    const result = searchBestMatch(context);

    expect(result).toMatchObject({
      kind: "incomplete",
      work: 4,
      truncation: { phase: "candidates", requiredWork: 5n },
    });
  });

  it("returns before the first stepped directional residual attempt", () => {
    const c2u = zeroAllowanceMatcher(budgetExtensionProbe("3c", "5f"), true);
    const u2c = zeroAllowanceMatcher(budgetExtensionProbe("3d", "60"), false);
    const context = boundedSearchContext([c2u, c2u], [u2c], 8, {
      ckbValue: 0n,
      udtValue: 0n,
    });

    const result = searchBestMatch(context);

    expect(result).toMatchObject({
      kind: "incomplete",
      work: 8,
      truncation: { phase: "candidates", requiredWork: 9n },
    });
  });

  it("returns when a charged cross inspection cannot start its residual attempt", () => {
    const c2u = zeroAllowanceMatcher(budgetExtensionProbe("3e", "61"), true);
    const u2c = zeroAllowanceMatcher(budgetExtensionProbe("3f", "62"), false);
    const context = boundedSearchContext([c2u, c2u], [u2c], 10, {
      ckbValue: 0n,
      udtValue: 0n,
    });

    const result = searchBestMatch(context);

    expect(result).toMatchObject({
      kind: "incomplete",
      work: 10,
      truncation: { phase: "candidates", requiredWork: 11n },
    });
  });
});

function budgetExtensionProbe(masterByte: string, outPointByte: string): OrderCell {
  return makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(10),
    udtValue: 0n,
    info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0),
    master: {
      type: "absolute",
      value: { txHash: byte32FromByte(masterByte), index: 1n },
    },
    outPoint: { txHash: byte32FromByte(outPointByte), index: 0n },
  });
}

function budgetExtensionMatcher(order: OrderCell): OrderMatcher {
  return new OrderMatcher(
    resolvedOrderGroup(order),
    true,
    1n,
    1n,
    0n,
    0n,
    0n,
    0n,
    1n,
    0n,
    1n,
    1n,
  );
}

function zeroAllowanceMatcher(order: OrderCell, isCkb2Udt: boolean): OrderMatcher {
  return new OrderMatcher(
    resolvedOrderGroup(order),
    isCkb2Udt,
    1n,
    1n,
    1n,
    0n,
    0n,
    0n,
    0n,
    0n,
    1n,
    1n,
  );
}

function boundedSearchContext(
  ckbToUdtMatchers: OrderMatcher[],
  udtToCkbMatchers: OrderMatcher[],
  candidateBudget: number,
  allowance: { ckbValue: bigint; udtValue: bigint },
): BestMatchContext {
  const diagnostics = budgetExtensionDiagnostics();
  diagnostics.orderCount = ckbToUdtMatchers.length + udtToCkbMatchers.length;
  diagnostics.allowance = allowance;
  diagnostics.candidateBudget = candidateBudget;
  diagnostics.directions.ckbToUdt.matchableCount = ckbToUdtMatchers.length;
  diagnostics.directions.udtToCkb.matchableCount = udtToCkbMatchers.length;
  return {
    allowance,
    candidateBudget,
    ckbAllowanceStep: 10n,
    ckbMiningFee: 0n,
    ckbScale: 1n,
    ckbToUdtMatchers,
    diagnostics,
    udtAllowanceStep: 10n,
    udtScale: 1n,
    udtToCkbMatchers,
  };
}

function budgetExtensionContext(
  emptyMatcher: OrderMatcher,
  filledMatcher: OrderMatcher,
): BestMatchContext {
  return {
    allowance: { ckbValue: 0n, udtValue: 1n },
    candidateBudget: 100,
    ckbAllowanceStep: 10n,
    ckbMiningFee: 0n,
    ckbScale: 1n,
    ckbToUdtMatchers: [emptyMatcher, filledMatcher],
    diagnostics: budgetExtensionDiagnostics(),
    udtAllowanceStep: 10n,
    udtScale: 1n,
    udtToCkbMatchers: [],
  };
}

function budgetExtensionDiagnostics(): BestMatchContext["diagnostics"] {
  return {
    orderCount: 2,
    allowance: { ckbValue: 0n, udtValue: 1n },
    candidateBudget: 100,
    workCount: 0,
    ckbAllowanceStep: 10n,
    udtAllowanceStep: 10n,
    ckbMiningFee: 0n,
    generatedStates: { ckbToUdt: 0, udtToCkb: 0 },
    directions: {
      ckbToUdt: { matchableCount: 2 },
      udtToCkb: { matchableCount: 0 },
    },
    candidates: {
      total: 0,
      viable: 0,
      positiveGain: 0,
      rejected: {
        maxPartials: 0,
        duplicateOrder: 0,
        insufficientCkbAllowance: 0,
        insufficientUdtAllowance: 0,
        nonPositiveGain: 0,
      },
      bestGain: 0n,
    },
  };
}
