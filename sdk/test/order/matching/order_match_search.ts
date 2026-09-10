import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import type { OrderGroup } from "../../../src/order/model/cells.ts";
import { Info } from "../../../src/order/model/info.ts";
import { Ratio } from "../../../src/order/model/ratio.ts";
import { OrderManager, type Match } from "../../../src/order/order.ts";
import {
  exhaustiveIntegerBestMatch,
  resolvedOrderGroups,
} from "./support/order_match_helpers.ts";
import { makeOrderCell } from "./support/order_order_helpers.ts";

const CKB = ccc.fixedPointFrom(1);
const L = 10_000n * CKB;
const D = CKB;
const UNIT = { ckbScale: 1n, udtScale: 1n };
/** The prepared fee of one partial at fee rate 1000 for the test order size. */
const FEE = 283n;

/** An order paying `ckb` CKB for `udt` iCKB, whole or partial; a log above the size makes it all-or-nothing. */
function buyer(
  byte: string,
  ckb: bigint,
  udt: bigint,
  ckbMinMatchLog = 0,
): ReturnType<typeof makeOrderCell> {
  return order(
    byte,
    ckb,
    0n,
    { ckbToUdt: ratioOf(ckb, udt), udtToCkb: Ratio.empty() },
    ckbMinMatchLog,
  );
}

/** An order paying `udt` iCKB for `ckb` CKB. */
function seller(
  byte: string,
  udt: bigint,
  ckb: bigint,
  ckbMinMatchLog = 0,
): ReturnType<typeof makeOrderCell> {
  return order(
    byte,
    0n,
    udt,
    { ckbToUdt: Ratio.empty(), udtToCkb: ratioOf(ckb, udt) },
    ckbMinMatchLog,
  );
}

/** `ckbScale * ckb = udtScale * udt` is the value conservation the contract checks. */
function ratioOf(ckb: bigint, udt: bigint): Ratio {
  const divisor = ccc.gcd(ckb, udt);
  return Ratio.from({ ckbScale: udt / divisor, udtScale: ckb / divisor });
}

function order(
  byte: string,
  ckbUnoccupied: bigint,
  udtValue: bigint,
  ratios: { ckbToUdt: Ratio; udtToCkb: Ratio },
  ckbMinMatchLog: number,
): ReturnType<typeof makeOrderCell> {
  return makeOrderCell({
    ckbUnoccupied,
    udtValue,
    info: Info.from({ ...ratios, ckbMinMatchLog }),
    master: { type: "absolute", value: { txHash: byte32FromByte(byte), index: 1n } },
    outPoint: { txHash: byte32FromByte(byte), index: 0n },
  });
}

function hashOf(index: number): ccc.Hex {
  return `0x${index.toString(16).padStart(64, "0")}`;
}

function gainAtUnit(match: Match, fee: bigint): bigint {
  return match.ckbDelta - fee * BigInt(match.partials.length) + match.udtDelta;
}

function expectFeasible(
  match: Match,
  allowance: { ckbValue: bigint; udtValue: bigint },
  fee: bigint,
): void {
  expect(
    allowance.ckbValue + match.ckbDelta - fee * BigInt(match.partials.length),
  ).toBeGreaterThanOrEqual(0n);
  expect(allowance.udtValue + match.udtDelta).toBeGreaterThanOrEqual(0n);
  expect(
    new Set(match.partials.map((partial) => partial.group.order.cell.outPoint.toHex()))
      .size,
  ).toBe(match.partials.length);
}

describe("best match search", () => {
  it("funds a buyer and a seller from each other with empty inventory", () => {
    const groups = resolvedOrderGroups([
      buyer("a1", 2n * L, L, 41),
      seller("a2", L, L, 41),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.kind).toBe("complete");
    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBe(L - 2n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("is not poisoned by a small best-margin buyer that would eat the seed of a large pair", () => {
    // The poison alone gains 2 CKB; the two large all-or-nothing orders with it gain over 10,000.
    const groups = resolvedOrderGroups([
      buyer("b1", (101n * L) / 100n, L, 41),
      seller("b2", 2n * L, L, 41),
      buyer("b3", 3n * D, D),
    ]);
    const allowance = { ckbValue: 0n, udtValue: L };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(3);
    expect(gainAtUnit(result.match, FEE)).toBe(L / 100n + L + 2n * D - 3n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("keeps a large buyer over the dust that would fill every slot ahead of it", () => {
    const orders = Array.from({ length: 57 }, (_, index) =>
      buyer((0x40 + index).toString(16), 4n * D, D),
    );
    orders.push(buyer("c1", 2n * L, L), buyer("c2", 3n * D, D));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: L + 58n * D };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(58);
    expect(
      result.match.partials.some(
        (partial) => partial.group.order.cell.outPoint.txHash === byte32FromByte("c1"),
      ),
    ).toBe(true);
    expect(gainAtUnit(result.match, FEE)).toBe(L + 57n * 3n * D - 58n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("crosses seventeen all-or-nothing buyers and one seller from empty inventory", () => {
    const orders = Array.from({ length: 17 }, (_, index) =>
      buyer((0x60 + index).toString(16), 2n * L, L, 41),
    );
    orders.push(seller("d1", 17n * L, 17n * L));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(18);
    expect(gainAtUnit(result.match, FEE)).toBe(17n * L - 18n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("sizes a thin-margin mutual funding pair in one step instead of round by round", () => {
    // Each side returns 1.000001 per unit paid; from 1,000 CKB the chain reaches the whole book.
    const big = 1_000_000n * L;
    const groups = resolvedOrderGroups([
      buyer("e1", (1_000_001n * big) / 1_000_000n, big),
      seller("e2", (1_000_001n * big) / 1_000_000n, big),
    ]);
    const allowance = { ckbValue: 1000n * CKB, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBeGreaterThan(big / 1_000_000n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("returns a feasible match on the rounding book that oscillated a greedy sweep", () => {
    const A = 2_000_000_000_000n;
    const groups = resolvedOrderGroups([
      order(
        "f1",
        4_200_000_000_000n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 20n, udtScale: 21n }),
          udtToCkb: Ratio.empty(),
        },
        0,
      ),
      order(
        "f2",
        0n,
        100_000_001n,
        {
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.from({ ckbScale: 100_000_001n, udtScale: 100_000_000n }),
        },
        0,
      ),
    ]);
    const allowance = { ckbValue: 0n, udtValue: A };
    const exchange = { ckbScale: A, udtScale: (21n * A) / 20n - FEE };

    const result = OrderManager.bestMatch(groups, allowance, exchange, {
      feeRate: 1000n,
    });

    expectFeasible(result.match, allowance, FEE);
    expect(result.match.diagnostics?.bestGain).toBeGreaterThan(0n);
  });

  it("lets a partial seller repair a whole buyer the inventory alone cannot fund", () => {
    // Whole fills alone cannot balance: the buyer needs iCKB the bot lacks and the whole
    // seller needs more CKB than the buyer releases; a partial seller closes the gap.
    const groups = resolvedOrderGroups([
      buyer("1a", 2n * L, L),
      seller("2a", 10n * L, 5n * L),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBeGreaterThan((299n * L) / 100n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("finds the large selection behind a small order taken first, within the budget", () => {
    const K = 1000n * CKB;
    const orders = Array.from({ length: 17 }, (_, index) =>
      buyer((0x70 + index).toString(16), 2n * K, K, 42),
    );
    orders.push(seller("3a", 17n * K, 33n * K, 42), buyer("4a", 3n * D, D));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(18);
    expect(gainAtUnit(result.match, FEE)).toBe(K - 18n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("keeps the funding seller of a lopsided book inside the per-direction cap", () => {
    const orders = Array.from({ length: 1000 }, (_, index) => {
      const byte = index.toString(16).padStart(2, "0").slice(-2);
      return order(
        byte,
        2n * D,
        0n,
        { ckbToUdt: ratioOf(2n * D, D), udtToCkb: Ratio.empty() },
        0,
      );
    });
    // Same-byte out points collide, so give every buyer its own transaction hash.
    const groups = resolvedOrderGroups(
      orders
        .map((cell, index) =>
          makeOrderCell({
            ckbUnoccupied: (index === 0 ? 3n : 2n) * D,
            udtValue: 0n,
            info: cell.data.info,
            master: { type: "absolute", value: { txHash: hashOf(index + 1), index: 1n } },
            outPoint: { txHash: hashOf(index + 1), index: 0n },
          }),
        )
        .concat([seller("5a", D, D)]),
    );
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.diagnostics?.truncatedMatchers).toBe(500);
    expect(result.match.partials.length).toBeGreaterThanOrEqual(2);
    expect(gainAtUnit(result.match, FEE)).toBeGreaterThan(0n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("fills a cell once when the pool repeats it", () => {
    const [group] = resolvedOrderGroups([buyer("6a", 2n * L, L)]);
    if (group === undefined) {
      throw new Error("expected one group");
    }
    const allowance = { ckbValue: 0n, udtValue: 2n * L };

    const result = OrderManager.bestMatch([group, group], allowance, UNIT, {
      feeRate: 1000n,
    });

    expect(result.match.partials).toHaveLength(1);
    expectFeasible(result.match, allowance, FEE);
  });

  it("reports an upper bound that covers a partial fill rounding above the whole fill's rate", () => {
    const T = 100_000_000_000n;
    const exchange = { ckbScale: 20n * T + 1n, udtScale: 21n * T + 1n - FEE };
    const groups = resolvedOrderGroups([
      buyer("7a", 105_000_283n, 100_000_000n),
      order(
        "8a",
        21n * (T + 1n) + 1n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 20n, udtScale: 21n }),
          udtToCkb: Ratio.empty(),
        },
        0,
      ),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 20n * (T + 1n) };

    const result = OrderManager.bestMatch(groups, allowance, exchange, {
      feeRate: 1000n,
      candidateBudget: 1,
    });
    const reachable = OrderManager.bestMatch(groups.slice(1), allowance, exchange, {
      feeRate: 1000n,
    });

    expect(result.kind).toBe("incomplete");
    expect(result.match.diagnostics?.gainUpperBound).toBeGreaterThanOrEqual(
      reachable.match.diagnostics?.bestGain ?? 0n,
    );
  });

  it("never beats the exhaustive oracle and agrees with it on most tiny books", () => {
    let state = 7;
    const next = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const draw = (max: number): bigint => BigInt(Math.floor(next() * max));
    let equal = 0;
    const trials = 60;
    for (let trial = 0; trial < trials; trial += 1) {
      const size = 2 + Number(draw(3));
      const groups: OrderGroup[] = resolvedOrderGroups(
        Array.from({ length: size }, (_, index) => {
          const ratio = Ratio.from({ ckbScale: 1n + draw(8), udtScale: 1n + draw(8) });
          const both = next() < 0.5;
          const isCkb2Udt = next() < 0.5;
          return makeOrderCell({
            ckbUnoccupied: draw(20),
            udtValue: draw(20),
            info: Info.from({
              ckbToUdt: both || isCkb2Udt ? ratio : Ratio.empty(),
              udtToCkb: both || !isCkb2Udt ? ratio : Ratio.empty(),
              ckbMinMatchLog: Number(draw(4)),
            }),
            master: {
              type: "absolute",
              value: { txHash: byte32FromByte((0x80 + index).toString(16)), index: 1n },
            },
            outPoint: { txHash: byte32FromByte((0x90 + index).toString(16)), index: 0n },
          });
        }),
      );
      const allowance = { ckbValue: draw(40), udtValue: draw(40) };
      const exchange = { ckbScale: 1n + draw(4), udtScale: 1n + draw(4) };
      const feeRate = next() < 0.5 ? 0n : 1000n;
      const result = OrderManager.bestMatch(groups, allowance, exchange, { feeRate });
      const fee = result.match.diagnostics?.ckbMiningFee ?? 0n;
      const oracle = exhaustiveIntegerBestMatch(groups, allowance, exchange, { feeRate });
      const gain = (match: Match): bigint =>
        (match.ckbDelta - fee * BigInt(match.partials.length)) * exchange.ckbScale +
        match.udtDelta * exchange.udtScale;
      expectFeasible(result.match, allowance, fee);
      expect(gain(result.match)).toBeLessThanOrEqual(gain(oracle));
      if (gain(result.match) === gain(oracle)) {
        equal += 1;
      }
    }
    expect(equal).toBeGreaterThanOrEqual(50);
  });
});
