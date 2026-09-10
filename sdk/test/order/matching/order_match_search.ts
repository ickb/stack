import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
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
/** The default minimum-match exponent: an order at most 2^33 shannons fills only whole. */
const WHOLE = 33;
/** A whole-only order size: twice this is still below the default minimum match. */
const W = 40n * CKB;
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
      buyer("a1", 2n * W, W, WHOLE),
      seller("a2", W, W, WHOLE),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.kind).toBe("complete");
    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBe(W - 2n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("is not poisoned by a small best-margin buyer that would eat the seed of a large pair", () => {
    // The small buyer alone gains 2 CKB; the two whole-only orders with it gain over 40.
    const groups = resolvedOrderGroups([
      buyer("b1", (101n * W) / 100n, W, WHOLE),
      seller("b2", 2n * W, W, WHOLE),
      buyer("b3", 3n * D, D),
    ]);
    const allowance = { ckbValue: 0n, udtValue: W };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(3);
    expect(gainAtUnit(result.match, FEE)).toBe(W / 100n + W + 2n * D - 3n * FEE);
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
      buyer((0x60 + index).toString(16), 2n * W, W, WHOLE),
    );
    orders.push(seller("d1", 17n * W, 17n * W));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(18);
    expect(gainAtUnit(result.match, FEE)).toBe(17n * W - 18n * FEE);
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
    const K = 2n * CKB;
    const S = D / 100n;
    const orders = Array.from({ length: 17 }, (_, index) =>
      buyer((0x70 + index).toString(16), 2n * K, K, WHOLE),
    );
    orders.push(seller("3a", 17n * K, 33n * K, WHOLE), buyer("4a", 3n * S, S));
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

  it("closes with an affordable partial when the best-margin order is out of reach", () => {
    // The small buyer is all-or-nothing and needs one unit more than the bot holds; the
    // large buyer's partial must still be taken.
    const groups = resolvedOrderGroups([
      buyer("1b", 10_000_000_000_000n, 5_000_000_000_000n),
      buyer("2b", 6_000_000_000n, 2_000_000_001n, WHOLE),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 2_000_000_000n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(1);
    expect(gainAtUnit(result.match, FEE)).toBe(2_000_000_000n - FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("uses a losing seller as the bridge that funds a winning buyer", () => {
    const groups = resolvedOrderGroups([
      buyer("3b", 2n * L, L),
      seller("4b", 2n * L, 3n * L),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBeGreaterThan(L / 2n - 3n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("takes both sellers whole to fund a partial of a buyer skipped whole", () => {
    // The buyer is large enough to fill partially above the default minimum match.
    const K = 20n * CKB;
    const groups = resolvedOrderGroups([
      buyer("5b", 10n * K, 5n * K, WHOLE),
      seller("6b", 2n * K, K),
      seller("7b", 2n * K, K),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(3);
    expect(gainAtUnit(result.match, FEE)).toBe(6n * K - 3n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("skips three small buyers that would unbalance an all-or-nothing selection", () => {
    const K = 2n * CKB;
    const orders = Array.from({ length: 17 }, (_, index) =>
      buyer((0x70 + index).toString(16), 2n * K, K, WHOLE),
    );
    orders.push(seller("8b", 17n * K, 33n * K, WHOLE));
    for (const byte of ["9b", "ab", "bb"]) {
      orders.push(buyer(byte, (3n * D) / 100n, D / 100n));
    }
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

  it("keeps the one affordable order when the cap would otherwise drop it", () => {
    const V = 14n * CKB;
    const orders = Array.from({ length: 500 }, (_, index) =>
      makeOrderCell({
        ckbUnoccupied: 6n * V,
        udtValue: 0n,
        info: Info.from({
          ckbToUdt: ratioOf(6n * V, 2n * V),
          udtToCkb: Ratio.empty(),
          ckbMinMatchLog: WHOLE,
        }),
        master: { type: "absolute", value: { txHash: hashOf(index + 1), index: 1n } },
        outPoint: { txHash: hashOf(index + 1), index: 0n },
      }),
    );
    orders.push(buyer("cb", 2n * V, V, WHOLE));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: V };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(1);
    expect(gainAtUnit(result.match, FEE)).toBe(V - FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("never fills both directions of one cell", () => {
    const ratio = Ratio.from({ ckbScale: 1_000_000n, udtScale: 1_000_001n });
    const groups = resolvedOrderGroups([
      order(
        "db",
        10_000_000_000_000n,
        100_000_000n,
        { ckbToUdt: ratio, udtToCkb: ratio },
        40,
      ),
    ]);
    const allowance = { ckbValue: 1_000_000_000_000n, udtValue: 1_099_511_626n };

    const result = OrderManager.bestMatch(
      groups,
      allowance,
      { ckbScale: 1n, udtScale: 1000n },
      { feeRate: 1000n },
    );

    expect(result.match.partials.length).toBeLessThanOrEqual(1);
    expectFeasible(result.match, allowance, FEE);
  });

  it("closes with the high-margin buyer behind two large low-margin ones", () => {
    // Both large buyers gain more whole than the small one, but the bot can only pay a
    // sliver of them; the small buyer's partial is worth a hundred times more.
    const groups = resolvedOrderGroups([
      buyer("d1", 10n * L, 9_990_000_000_000n),
      buyer("d2", 10n * L, 9_990_000_000_000n),
      buyer("d3", 10_000_000_000n, D + 1n),
    ]);
    const allowance = { ckbValue: 0n, udtValue: D };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(gainAtUnit(result.match, FEE)).toBe(9_899_999_617n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("finds the one payable buyer behind thirty-two all-or-nothing ones and an unpayable seller", () => {
    // Each blocker needs one unit more iCKB than the bot holds and the seller that could
    // hand it over asks more CKB than every blocker offers, so nothing whole is payable.
    const Q = 2_000_000_000n;
    const orders = Array.from({ length: 32 }, (_, index) =>
      makeOrderCell({
        ckbUnoccupied: 3n * Q,
        udtValue: 0n,
        info: Info.from({
          ckbToUdt: ratioOf(3n * Q, Q + 1n),
          udtToCkb: Ratio.empty(),
          ckbMinMatchLog: WHOLE,
        }),
        master: { type: "absolute", value: { txHash: hashOf(index + 1), index: 1n } },
        outPoint: { txHash: hashOf(index + 1), index: 0n },
      }),
    );
    orders.push(buyer("d4", 2n * Q, Q + 1n, 0), seller("d5", Q, 10n * L, WHOLE));
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: Q };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(gainAtUnit(result.match, FEE)).toBe((2n * Q * Q) / (Q + 1n) - Q - FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("raises a repairing fill to the order's minimum match", () => {
    // The seller is worth taking whole but costs CKB the bot lacks; the buyer repays it
    // only at exactly its minimum match, which the deficit alone falls short of.
    const M = 1n << 27n;
    const groups = resolvedOrderGroups([
      buyer("d6", 1_000_000_000n, 10n * L, 27),
      seller("d7", (M + D) * 10_000n, M - 1n - 2n * FEE),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(gainAtUnit(result.match, FEE)).toBe(1_000_000_000_001n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("never probes past its budget", () => {
    const groups = resolvedOrderGroups([
      buyer("d8", 2n * L, L),
      seller("d9", 2n * L, L),
      buyer("da", 2n * L, L),
    ]);
    const probes = vi.spyOn(OrderMatcher.prototype, "match");

    for (const candidateBudget of [1, 2, 3, 5, 8, 13]) {
      probes.mockClear();
      const result = OrderManager.bestMatch(groups, { ckbValue: 0n, udtValue: L }, UNIT, {
        feeRate: 1000n,
        candidateBudget,
      });
      expect(probes.mock.calls.length).toBeLessThanOrEqual(candidateBudget);
      expect(result.match.diagnostics?.workCount).toBeLessThanOrEqual(candidateBudget);
    }
    probes.mockRestore();
  });

  it("closes with the seller whose minimum the CKB covers when two others' minimums round past it", () => {
    // All three sellers share the minimum exponent; the bot holds exactly that minimum
    // plus one fee, which the two cheaper ratios round past and the useful one meets.
    const M = 1n << BigInt(WHOLE);
    const groups = resolvedOrderGroups([
      seller("e1", 4n * W, 3n * W, WHOLE),
      seller("e2", 4n * W, 3n * W, WHOLE),
      seller("e3", 5n * W, 4n * W, WHOLE),
    ]);
    const allowance = { ckbValue: M + FEE, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(gainAtUnit(result.match, FEE)).toBe(M / 4n - FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("ranks closers by the gain of the fill after its whole fee", () => {
    // The two large buyers gain a little per unit but lose the fee on the sliver the
    // bot can pay; the small buyer gains 116 after the fee.
    const groups = resolvedOrderGroups([
      buyer("e4", 10n * L, 9_999_980_000_000n),
      buyer("e5", 10n * L, 9_999_980_000_000n),
      buyer("e6", 100_000_401n, 100_000_001n),
    ]);
    const allowance = { ckbValue: 0n, udtValue: D };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(gainAtUnit(result.match, FEE)).toBe(116n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("returns from a four-thousand-order book of losing orders within a second", () => {
    // Buyer i needs one unit more iCKB than sellers 1..i supply and seller i one fee
    // less CKB than buyers 1..i offer; nothing gains, and the sweep drops what no
    // combination could pay.
    const N = 2000;
    const orders = Array.from({ length: N }, (_, index) => {
      const i = BigInt(index + 1);
      return [
        makeOrderCell({
          ckbUnoccupied: 2n * D,
          udtValue: 0n,
          info: Info.from({
            ckbToUdt: ratioOf(2n * D, i * 2n * D + 1n),
            udtToCkb: Ratio.empty(),
            ckbMinMatchLog: WHOLE,
          }),
          master: {
            type: "absolute",
            value: { txHash: hashOf(2 * index + 1), index: 1n },
          },
          outPoint: { txHash: hashOf(2 * index + 1), index: 0n },
        }),
        makeOrderCell({
          ckbUnoccupied: 0n,
          udtValue: 2n * D,
          info: Info.from({
            ckbToUdt: Ratio.empty(),
            udtToCkb: ratioOf(i * 2n * D - FEE, 2n * D),
            ckbMinMatchLog: WHOLE,
          }),
          master: {
            type: "absolute",
            value: { txHash: hashOf(2 * index + 2), index: 1n },
          },
          outPoint: { txHash: hashOf(2 * index + 2), index: 0n },
        }),
      ];
    }).flat();
    const groups = resolvedOrderGroups(orders);
    const started = performance.now();

    const result = OrderManager.bestMatch(groups, { ckbValue: 0n, udtValue: 0n }, UNIT, {
      feeRate: 1000n,
      candidateBudget: 1,
    });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.match.partials).toHaveLength(0);
    expect(result.match.diagnostics?.truncatedMatchers).toBeGreaterThan(0);
  });

  it("crosses the all-or-nothing book behind one buyer with a larger whole gain", () => {
    // The extra buyer sorts first and is repayable in principle, but nothing below it
    // is feasible with it taken; the walk must not spend the budget under it.
    const K = 2n * CKB;
    const orders = Array.from({ length: 17 }, (_, index) =>
      buyer((0xa0 + index).toString(16), 2n * K, K, WHOLE),
    );
    orders.push(
      seller("c0", 17n * K, 33n * K, WHOLE),
      buyer("c1", 3n * K + 17n * FEE, 2n * K, WHOLE),
    );
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

  it("leaves orders with a minimum-match exponent above the default to other bots", () => {
    // Fifteen whole-only orders with exponent 50, twelve large buyers no seller can
    // balance and a small self-funding pair hidden behind them, plus one order a step
    // above the default and one at it: only the last is matched.
    const orders = Array.from({ length: 12 }, (_, index) =>
      buyer((0x10 + index).toString(16), 2n * L, L, 50),
    );
    orders.push(
      seller("30", (23n * L) / 2n, (45n * L) / 2n, 50),
      buyer("31", 3n * D, D, 50),
      seller("32", D, 2n * D, 50),
      buyer("33", 2n * W, W, WHOLE + 1),
      buyer("34", 2n * W, W, WHOLE),
    );
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: W };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.diagnostics?.directions.ckbToUdt.matchableCount).toBe(1);
    expect(result.match.diagnostics?.directions.udtToCkb.matchableCount).toBe(0);
    expect(result.match.partials).toHaveLength(1);
    expect(gainAtUnit(result.match, FEE)).toBe(W - FEE);
  });

  it("bounds a partial's gain by one unit of the paid asset at the order's own ratio", () => {
    // One iCKB unit buys 1.5 million shannons; the buyer's whole fill of three units
    // rounds its payment up, so its two-unit partial gains a third more per unit than
    // the whole. Two one-unit sellers fund it.
    const groups = resolvedOrderGroups([
      order(
        "f1",
        4_000_000n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1_500_000n }),
          udtToCkb: Ratio.empty(),
        },
        21,
      ),
      ...["f2", "f3"].map((byte) =>
        order(
          byte,
          0n,
          1n,
          {
            ckbToUdt: Ratio.empty(),
            udtToCkb: Ratio.from({ ckbScale: 1n, udtScale: 1_400_000n }),
          },
          0,
        ),
      ),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(3);
    expect(gainAtUnit(result.match, FEE)).toBe(199_151n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("repairs a deficit with the exact payment when one unit more would lose the gain", () => {
    const Q = D;
    const groups = resolvedOrderGroups([
      buyer("f4", 2n * Q + 2n * FEE + 1n, Q, 0),
      seller("f5", 2n * Q, 4n * Q, 0),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, { feeRate: 1000n });

    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBe(1n);
    expectFeasible(result.match, allowance, FEE);
  });

  it("reaches a small pair hidden behind whole-only orders no combination completes", () => {
    // Twelve buyers under 86 CKB and a seller that eleven of them cannot pay and twelve
    // overfill: every subtree with them is a dead end, and the gain-first walk spends
    // its budget there; the smallest-first walk finds the pair within a few nodes.
    const V = 2n * CKB;
    const S = D / 100n;
    const orders = Array.from({ length: 12 }, (_, index) =>
      buyer((0x10 + index).toString(16), 2n * V, V, WHOLE),
    );
    orders.push(
      seller("30", (23n * V) / 2n, (45n * V) / 2n, WHOLE),
      buyer("31", 3n * S, S, WHOLE),
      seller("32", S, 2n * S, WHOLE),
    );
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: 0n };

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(result.match.partials).toHaveLength(2);
    expect(gainAtUnit(result.match, FEE)).toBe(S - 2n * FEE);
    expectFeasible(result.match, allowance, FEE);
  });

  it("keeps scanning closers past whole fills that gain nothing", () => {
    // Two buyers whose whole fill gains exactly zero sort ahead of a buyer whose partial
    // gains fifty; the scan must not stop on the zero gains.
    const exchange = { ckbScale: 1n, udtScale: 1000n };
    const groups = resolvedOrderGroups([
      order(
        "e7",
        1_283n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1_283n }),
          udtToCkb: Ratio.empty(),
        },
        0,
      ),
      order(
        "e8",
        1_283n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1_283n }),
          udtToCkb: Ratio.empty(),
        },
        0,
      ),
      order(
        "e9",
        2_000n,
        0n,
        {
          ckbToUdt: Ratio.from({ ckbScale: 3n, udtScale: 4_000n }),
          udtToCkb: Ratio.empty(),
        },
        0,
      ),
    ]);
    const allowance = { ckbValue: 0n, udtValue: 1n };

    const result = OrderManager.bestMatch(groups, allowance, exchange, {
      feeRate: 1000n,
    });

    expect(result.match.partials).toHaveLength(1);
    expect(result.match.diagnostics?.bestGain).toBe(50n);
  });

  it("pairs buyers and sellers on a balanced thousand-order book within a few hundred milliseconds", () => {
    const orders = Array.from({ length: 1000 }, (_, index) =>
      makeOrderCell({
        ckbUnoccupied: index < 500 ? 2n * D : 0n,
        udtValue: index < 500 ? 0n : 2n * D,
        info: Info.from({
          ckbToUdt: index < 500 ? ratioOf(2n * D, D) : Ratio.empty(),
          udtToCkb: index < 500 ? Ratio.empty() : ratioOf(D, 2n * D),
          ckbMinMatchLog: 0,
        }),
        master: { type: "absolute", value: { txHash: hashOf(index + 1), index: 1n } },
        outPoint: { txHash: hashOf(index + 1), index: 0n },
      }),
    );
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 0n, udtValue: 0n };
    const started = performance.now();

    const result = OrderManager.bestMatch(groups, allowance, UNIT, {
      feeRate: 1000n,
      maxPartials: 58,
    });

    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.match.partials).toHaveLength(58);
    expect(gainAtUnit(result.match, FEE)).toBe(58n * (D - FEE));
    expectFeasible(result.match, allowance, FEE);
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
