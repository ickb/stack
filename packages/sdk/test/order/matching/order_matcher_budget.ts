import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import { Info } from "../../../src/order/model/info.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  exhaustiveIntegerBestMatch,
  makeUdtToCkbOrder,
  matchKey,
  resolvedOrderGroup,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { byte32FromByte, makeOrderCell } from "./support/order_order_helpers.ts";

const ALLOWANCE = { ckbValue: 200n, udtValue: 0n };
const EXCHANGE_RATE = { ckbScale: 1n, udtScale: 100n };
const EXACT_OPTIONS = {
  feeRate: 0n,
  ckbAllowanceStep: 1n,
  maxPartials: 1,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe(`${ORDER_MATCHER_SUITE} candidate budget`, () => {
  it.each([0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid candidate budget %s",
    (candidateBudget) => {
      expect(() =>
        OrderManager.bestMatch([], ALLOWANCE, EXCHANGE_RATE, { candidateBudget }),
      ).toThrow("Candidate budget must be a positive safe integer");
    },
  );
});

describe(`${ORDER_MATCHER_SUITE} maximum partials`, () => {
  it.each([
    -1,
    -0.5,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
  ])("rejects invalid maximum partials %s", (maxPartials) => {
    expect(() =>
      OrderManager.bestMatch([], ALLOWANCE, EXCHANGE_RATE, { maxPartials }),
    ).toThrow("Maximum partials must be a non-negative safe integer");
  });

  it("accepts a zero maximum at the empty-pool boundary", () => {
    expect(
      OrderManager.bestMatch([], ALLOWANCE, EXCHANGE_RATE, { maxPartials: 0 }),
    ).toMatchObject({ kind: "complete", match: { partials: [] } });
  });
});

describe(`${ORDER_MATCHER_SUITE} bounded result`, () => {
  it("returns complete only when the atomic preflight and search fit", () => {
    const result = OrderManager.bestMatch(
      [resolvedOrderGroup(makeUdtToCkbOrder({ udtValue: 100n }))],
      ALLOWANCE,
      EXCHANGE_RATE,
      { ...EXACT_OPTIONS, candidateBudget: 1000 },
    );

    expect(result).toMatchObject({
      kind: "complete",
      match: { ckbDelta: -40n, udtDelta: 100n },
    });
    expect(result.match.diagnostics?.workCount).toBeLessThanOrEqual(1000);
  });

  it("returns the same best-so-far and truncation at a deterministic boundary", () => {
    const run = (): ReturnType<typeof OrderManager.bestMatch> =>
      OrderManager.bestMatch(
        [resolvedOrderGroup(makeUdtToCkbOrder({ udtValue: 100n }))],
        ALLOWANCE,
        EXCHANGE_RATE,
        { ...EXACT_OPTIONS, candidateBudget: 5 },
      );

    const first = run();
    const second = run();

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      searchMode: "stepped",
      budget: 5,
      work: 5,
      truncation: { phase: "udtToCkbFrontier", requiredWork: 6n },
    });
  });
});

describe(`${ORDER_MATCHER_SUITE} online budget boundaries`, () => {
  it("returns at the first online CKB frontier boundary", () => {
    const result = OrderManager.bestMatch(
      resolvedOrderGroups([boundedDirectionalOrder(true, "39")]),
      { ckbValue: 0n, udtValue: 1n },
      { ckbScale: 2n, udtScale: 1n },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1n,
        maxPartials: 1,
        candidateBudget: 1,
      },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      work: 1,
      truncation: { phase: "ckbToUdtFrontier", requiredWork: 2n },
    });
  });
});

describe(`${ORDER_MATCHER_SUITE} successful probe budget`, () => {
  it("returns the best successful probe before a later charged boundary", () => {
    const groups = successfulProbeGroups();
    const matchOrder = vi.spyOn(OrderMatcher.prototype, "match");
    const options = {
      feeRate: 0n,
      ckbAllowanceStep: 1n,
      maxPartials: 2,
    } as const;

    const standaloneBoundary = OrderManager.bestMatch(
      groups,
      { ckbValue: 0n, udtValue: 2n },
      { ckbScale: 2n, udtScale: 1n },
      { ...options, candidateBudget: 3 },
    );
    expect(standaloneBoundary).toMatchObject({
      kind: "incomplete",
      work: 3,
      truncation: { phase: "candidates", requiredWork: 4n },
    });
    matchOrder.mockClear();

    const bounded = OrderManager.bestMatch(
      groups,
      { ckbValue: 0n, udtValue: 2n },
      { ckbScale: 2n, udtScale: 1n },
      { ...options, candidateBudget: 4 },
    );

    expect(matchOrder.mock.calls.map(([allowance]) => allowance)).toEqual([1n, 2n]);
    expect(bounded).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      searchMode: "stepped",
      budget: 4,
      work: 4,
      truncation: { phase: "candidates", requiredWork: 5n },
      match: {
        ckbDelta: 2n,
        udtDelta: -2n,
        diagnostics: {
          workCount: 4,
          generatedStates: { ckbToUdt: 3, udtToCkb: 1 },
          candidates: { total: 2, viable: 3, positiveGain: 2, bestGain: 2n },
        },
      },
    });

    matchOrder.mockClear();
    const complete = OrderManager.bestMatch(
      groups,
      { ckbValue: 0n, udtValue: 2n },
      { ckbScale: 2n, udtScale: 1n },
      { ...options, candidateBudget: 5 },
    );

    expect(matchOrder.mock.calls.map(([allowance]) => allowance)).toEqual([1n, 2n]);
    expect(complete).toMatchObject({
      kind: "complete",
      match: {
        ckbDelta: 2n,
        udtDelta: -2n,
        diagnostics: {
          workCount: 5,
          generatedStates: { ckbToUdt: 3, udtToCkb: 1 },
          candidates: { total: 3, viable: 3, positiveGain: 2, bestGain: 2n },
        },
      },
    });
  });
});

function successfulProbeGroups(): ReturnType<typeof resolvedOrderGroups> {
  const endpointOrder = makeOrderCell({
    ckbUnoccupied: 2n,
    udtValue: 0n,
    info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0),
    master: {
      type: "absolute",
      value: { txHash: byte32FromByte("44"), index: 1n },
    },
    outPoint: { txHash: byte32FromByte("45"), index: 0n },
  });
  const unmatchableOrder = makeOrderCell({
    ckbUnoccupied: 0n,
    udtValue: 0n,
    info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0),
    master: {
      type: "absolute",
      value: { txHash: byte32FromByte("46"), index: 1n },
    },
    outPoint: { txHash: byte32FromByte("47"), index: 0n },
  });
  return resolvedOrderGroups([endpointOrder, unmatchableOrder]);
}

describe(`${ORDER_MATCHER_SUITE} pair budget boundary`, () => {
  it("skips impossible pairs and stops at the first feasible cross candidate", () => {
    const result = OrderManager.bestMatch(
      resolvedOrderGroups([
        boundedDirectionalOrder(true, "3a"),
        boundedDirectionalOrder(false, "3b"),
      ]),
      { ckbValue: 1n, udtValue: 1n },
      { ckbScale: 2n, udtScale: 1n },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1n,
        maxPartials: 2,
        candidateBudget: 4,
      },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      work: 4,
      truncation: { phase: "candidates", requiredWork: 5n },
    });
  });
});

describe(`${ORDER_MATCHER_SUITE} stepped search`, () => {
  it("bounds a production-scale singleton and retains its endpoint match", () => {
    const group = resolvedOrderGroup(makeUdtToCkbOrder());
    const matchOrder = vi.spyOn(OrderMatcher.prototype, "match");
    const startedAt = Date.now();

    const result = OrderManager.bestMatch(
      [group],
      { ckbValue: ccc.fixedPointFrom(1000), udtValue: 0n },
      { ckbScale: 1n, udtScale: 100n },
      { feeRate: 0n, ckbAllowanceStep: ccc.fixedPointFrom(1), maxPartials: 1 },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "atomic_domain_exceeds_budget",
      searchMode: "stepped",
      budget: 100_000,
      match: { partials: [{ group }] },
    });
    if (result.kind !== "incomplete") {
      throw new Error("Expected incomplete search result");
    }
    expect(result.work).toBeLessThan(200);
    expect(matchOrder.mock.calls.length).toBeLessThan(100);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(ccc.fixedPointFrom(1000) + result.match.ckbDelta).toBeGreaterThanOrEqual(0n);
    expect(result.match.udtDelta).toBeGreaterThan(0n);
    const udtScript = group.order.cell.cellOutput.type;
    if (udtScript === undefined) {
      throw new Error("Expected order UDT type script");
    }
    expect(
      new OrderManager(group.order.cell.cellOutput.lock, [], udtScript).addMatch(
        ccc.Transaction.default(),
        result.match,
      ).inputs,
    ).toHaveLength(1);
  });

  it("certifies an exact grid covered by its successful probes", () => {
    const order = makeOrderCell({
      ckbUnoccupied: 3n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 3n, udtScale: 2n }, 0),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("35"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("36"), index: 0n },
    });
    const groups = resolvedOrderGroups([order]);
    const allowance = { ckbValue: 0n, udtValue: 5n };
    const exchangeRate = { ckbScale: 5n, udtScale: 3n };
    const options = {
      feeRate: 0n,
      ckbAllowanceStep: 4n,
      maxPartials: 1,
      candidateBudget: 6,
    };

    const result = OrderManager.bestMatch(groups, allowance, exchangeRate, options);
    const oracle = exhaustiveIntegerBestMatch(groups, allowance, exchangeRate, options);

    expect(result).toMatchObject({
      kind: "complete",
      match: { ckbDelta: 2n, udtDelta: -3n },
    });
    expect(matchKey(oracle)).toMatchObject({ ckbDelta: 2n, udtDelta: -3n });
  });
});

describe(`${ORDER_MATCHER_SUITE} zero partial cap`, () => {
  it("certifies a production-scale domain without probing it", () => {
    const matchOrder = vi.spyOn(OrderMatcher.prototype, "match");

    const result = OrderManager.bestMatch(
      [resolvedOrderGroup(makeUdtToCkbOrder())],
      { ckbValue: ccc.fixedPointFrom(1000), udtValue: ccc.fixedPointFrom(1000) },
      { ckbScale: 1n, udtScale: 100n },
      { feeRate: 0n, ckbAllowanceStep: 1n, maxPartials: 0 },
    );

    expect(result).toMatchObject({
      kind: "complete",
      match: {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
        diagnostics: {
          candidateBudget: 100_000,
          workCount: 1,
          generatedStates: { ckbToUdt: 1, udtToCkb: 1 },
          candidates: { total: 1, viable: 1, bestGain: 0n },
        },
      },
    });
    expect(matchOrder).not.toHaveBeenCalled();
  });
});

describe(`${ORDER_MATCHER_SUITE} bounded memory`, () => {
  it("caps retained states for a large dual order", () => {
    const ratio = { ckbScale: 1n, udtScale: 1n };
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: ccc.fixedPointFrom(1000),
      info: Info.from({ ckbToUdt: ratio, udtToCkb: ratio, ckbMinMatchLog: 0 }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("37"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("38"), index: 0n },
    });

    const result = OrderManager.bestMatch(
      resolvedOrderGroups([order]),
      { ckbValue: ccc.fixedPointFrom(1000), udtValue: ccc.fixedPointFrom(1000) },
      { ckbScale: 2n, udtScale: 3n },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1n,
        maxPartials: 1,
        candidateBudget: 100,
      },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      budget: 100,
      work: 100,
    });
    const generated = result.match.diagnostics?.generatedStates;
    expect((generated?.ckbToUdt ?? 0) + (generated?.udtToCkb ?? 0)).toBeLessThanOrEqual(
      100,
    );
  });
});

describe(`${ORDER_MATCHER_SUITE} stepped grid bound`, () => {
  it("caps a one-shannon grid independently of a million-unit budget", () => {
    const startedAt = Date.now();
    const result = OrderManager.bestMatch(
      [resolvedOrderGroup(makeUdtToCkbOrder())],
      { ckbValue: ccc.fixedPointFrom(1000), udtValue: 0n },
      { ckbScale: 1n, udtScale: 100n },
      {
        feeRate: 0n,
        ckbAllowanceStep: 1n,
        maxPartials: 1,
        candidateBudget: 1_000_000,
      },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "atomic_domain_exceeds_budget",
      truncation: { phase: "preflight", requiredWork: 1_000_001n },
    });
    expect(result.match.diagnostics?.workCount).toBeLessThan(10_000);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe(`${ORDER_MATCHER_SUITE} impossible pair bound`, () => {
  it("charges ineligible directional state inspections before filtering", () => {
    const n = 200n;
    const ratio = { ckbScale: 1n, udtScale: 1n };
    const order = makeOrderCell({
      ckbUnoccupied: n,
      udtValue: n,
      info: Info.from({ ckbToUdt: ratio, udtToCkb: ratio, ckbMinMatchLog: 0 }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("3e"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("3f"), index: 0n },
    });
    const group = resolvedOrderGroup(order);
    const startedAt = Date.now();
    const run = (): ReturnType<typeof OrderManager.bestMatch> =>
      OrderManager.bestMatch([group, group], { ckbValue: n, udtValue: n }, ratio, {
        feeRate: 0n,
        ckbAllowanceStep: 1n,
        maxPartials: 2,
        candidateBudget: 2500,
      });

    const result = run();

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      work: 2500,
      truncation: { phase: "ckbToUdtFrontier", requiredWork: 2501n },
      match: {
        diagnostics: {
          generatedStates: { ckbToUdt: 213, udtToCkb: 0 },
          candidates: {
            total: 1,
          },
        },
      },
    });
    expect(run()).toEqual(result);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

describe(`${ORDER_MATCHER_SUITE} duplicate pair inspection bound`, () => {
  it("charges duplicate Cartesian inspections before filtering", () => {
    const n = 200n;
    const ratio = { ckbScale: 1n, udtScale: 1n };
    const order = makeOrderCell({
      ckbUnoccupied: n,
      udtValue: n,
      info: Info.from({ ckbToUdt: ratio, udtToCkb: ratio, ckbMinMatchLog: 0 }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("40"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("41"), index: 0n },
    });
    const dummy = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: 0n,
      info: Info.create(true, ratio, 0),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("42"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("43"), index: 0n },
    });

    const result = OrderManager.bestMatch(
      resolvedOrderGroups([order, dummy]),
      { ckbValue: n, udtValue: n },
      ratio,
      { feeRate: 0n, ckbAllowanceStep: 1n, maxPartials: 2, candidateBudget: 2500 },
    );

    expect(result).toMatchObject({
      kind: "incomplete",
      reason: "candidate_budget_exhausted",
      work: 2500,
      truncation: { phase: "candidates", requiredWork: 2501n },
      match: {
        diagnostics: {
          generatedStates: { ckbToUdt: 201, udtToCkb: 201 },
          candidates: {
            total: 2100,
            rejected: { duplicateOrder: 2088, maxPartials: 0 },
          },
        },
      },
    });
  });
});

describe(`${ORDER_MATCHER_SUITE} structural pair bypass`, () => {
  it("does not traverse a dual singleton Cartesian product", () => {
    const n = 10_000n;
    const ratio = { ckbScale: 1n, udtScale: 1n };
    const order = makeOrderCell({
      ckbUnoccupied: n,
      udtValue: n,
      info: Info.from({ ckbToUdt: ratio, udtToCkb: ratio, ckbMinMatchLog: 0 }),
      master: {
        type: "absolute",
        value: { txHash: byte32FromByte("3c"), index: 1n },
      },
      outPoint: { txHash: byte32FromByte("3d"), index: 0n },
    });
    const startedAt = Date.now();

    const result = OrderManager.bestMatch(
      resolvedOrderGroups([order]),
      { ckbValue: n, udtValue: n },
      { ckbScale: 1n, udtScale: 1n },
      { feeRate: 0n, ckbAllowanceStep: 1n, maxPartials: 1 },
    );

    const generated = result.match.diagnostics?.generatedStates;
    const pairSpace = (generated?.ckbToUdt ?? 0) * (generated?.udtToCkb ?? 0);
    expect(result.match.diagnostics?.workCount).toBeLessThan(pairSpace);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

function boundedDirectionalOrder(
  isCkb2Udt: boolean,
  byte: string,
): ReturnType<typeof makeOrderCell> {
  return makeOrderCell({
    ckbUnoccupied: isCkb2Udt ? 1n : 0n,
    udtValue: isCkb2Udt ? 0n : 1n,
    info: Info.create(isCkb2Udt, { ckbScale: 1n, udtScale: 1n }, 0),
    master: {
      type: "absolute",
      value: { txHash: byte32FromByte(byte), index: 1n },
    },
    outPoint: { txHash: byte32FromByte(byte), index: 0n },
  });
}
