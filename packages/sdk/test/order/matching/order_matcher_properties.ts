/**
 * Property layer over the order matcher, adjudicated by the contract oracle.
 *
 * Generalizes the grid-sweep oracle suite (order_matcher_oracle.ts) across both
 * scale regimes: arbitrary ratios with ckbScale and udtScale drawn independently
 * from 1..2^20 (so ckbScale above and below udtScale are both covered), plus the
 * pinned unit ratio and the C1 2:1 / 1:2 pair.
 *
 * Seed discipline: fast-check prints the failing seed and the shrunk
 * counterexample on failure. Set VITEST_FC_SEED=<seed> to replay that exact run,
 * for example `VITEST_FC_SEED=42 pnpm vitest run packages/order`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Match } from "../../../src/order/matching/match_types.ts";
import type { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import type { OrderCell } from "../../../src/order/model/cells.ts";
import { Info } from "../../../src/order/model/info.ts";
import { adjudicate, mustMatcher, orderWith } from "./support/order_oracle_helpers.ts";

// This package is browser-safe and loads no node types; declare the one node
// global the seed hook needs instead of widening the package's program.
declare const process: { env: Record<string, string | undefined> };

const seedText = process.env["VITEST_FC_SEED"];
fc.configureGlobal({
  numRuns: 250,
  ...(seedText === undefined ? {} : { seed: Number(seedText) }),
});

const MAX_SCALE = 1n << 20n;
const MAX_AMOUNT = 10n ** 14n;

/** Ratios spanning both scale regimes plus the unit and C1 2:1 / 1:2 constants. */
const ratioArb = fc.oneof(
  {
    arbitrary: fc.record({
      ckbScale: fc.bigInt({ min: 1n, max: MAX_SCALE }),
      udtScale: fc.bigInt({ min: 1n, max: MAX_SCALE }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.constantFrom(
      { ckbScale: 1n, udtScale: 1n },
      { ckbScale: 2n, udtScale: 1n },
      { ckbScale: 1n, udtScale: 2n },
    ),
    weight: 1,
  },
);

const allowanceArb = fc.bigInt({ min: 0n, max: MAX_AMOUNT });

/** Mining fees the matcher reserves, plus a pinned nonzero constant case. */
const feeArb = fc.oneof(
  { arbitrary: fc.bigInt({ min: 0n, max: 10n ** 7n }), weight: 3 },
  { arbitrary: fc.constant(100_000n), weight: 1 },
);

/** Orders guaranteed matchable in the requested direction at the given fee. */
function orderArb(isCkb2Udt: boolean, ckbMiningFee = 0n): fc.Arbitrary<OrderCell> {
  return fc
    .record({
      ratio: ratioArb,
      ckbMinMatchLog: fc.integer({ min: 0, max: 20 }),
      // The ckb2udt admission check is aIn > aMin + fee, i.e. ckbUnoccupied > fee.
      ckbUnoccupied: fc.bigInt({
        min: isCkb2Udt ? ckbMiningFee + 1n : 0n,
        max: MAX_AMOUNT,
      }),
      udtValue: fc.bigInt({ min: isCkb2Udt ? 0n : 1n, max: MAX_AMOUNT }),
    })
    .map(({ ratio, ckbMinMatchLog, ckbUnoccupied, udtValue }) =>
      orderWith({
        info: Info.create(isCkb2Udt, ratio, ckbMinMatchLog),
        ckbUnoccupied,
        udtValue,
      }),
    );
}

/** Fee plus an order that stays matchable under it. */
function orderAndFeeArb(
  isCkb2Udt: boolean,
): fc.Arbitrary<{ order: OrderCell; ckbMiningFee: bigint }> {
  return feeArb.chain((ckbMiningFee) =>
    fc.record({
      order: orderArb(isCkb2Udt, ckbMiningFee),
      ckbMiningFee: fc.constant(ckbMiningFee),
    }),
  );
}

/** Amount of the b-side asset the matcher's caller pays into the match. */
function consumedB(matcher: OrderMatcher, match: Match): bigint {
  return matcher.isCkb2Udt ? -match.udtDelta : -match.ckbDelta;
}

const DIRECTIONS = [
  { name: "ckb2udt", isCkb2Udt: true },
  { name: "udt2ckb", isCkb2Udt: false },
];

describe("order matcher properties versus contract oracle", () => {
  it.each(DIRECTIONS)(
    "$name: every emitted partial satisfies the contract at any ckbMiningFee",
    ({ isCkb2Udt }) => {
      // The fee is a matcher-side margin the contract never sees, so contract
      // validity of emitted partials must be fee-invariant.
      fc.assert(
        fc.property(
          orderAndFeeArb(isCkb2Udt),
          allowanceArb,
          fc.bigInt({ min: 0n, max: 3n }),
          ({ order, ckbMiningFee }, allowance, boundaryOffset) => {
            const matcher = mustMatcher(order, isCkb2Udt, ckbMiningFee);
            // Probe the drawn allowance plus the min-match boundary band, which
            // uniform draws almost never hit and where defect C1 lived.
            for (const bAllowance of [allowance, matcher.bMinMatch + boundaryOffset]) {
              const match = matcher.match(bAllowance);
              expect(adjudicate(order, match)).toEqual(match.partials.map(() => "ok"));
            }
          },
        ),
      );
    },
  );

  it.each(DIRECTIONS)(
    "$name: never consumes more b than the allowance",
    ({ isCkb2Udt }) => {
      fc.assert(
        fc.property(orderArb(isCkb2Udt), allowanceArb, (order, allowance) => {
          const matcher = mustMatcher(order, isCkb2Udt);
          const consumed = consumedB(matcher, matcher.match(allowance));
          expect(consumed).toBeGreaterThanOrEqual(0n);
          expect(consumed).toBeLessThanOrEqual(allowance);
        }),
      );
    },
  );

  it.each(DIRECTIONS)(
    "$name: b consumption is monotone in the allowance",
    ({ isCkb2Udt }) => {
      fc.assert(
        fc.property(
          orderArb(isCkb2Udt),
          allowanceArb,
          allowanceArb,
          (order, first, second) => {
            const [low, high] = first <= second ? [first, second] : [second, first];
            const matcher = mustMatcher(order, isCkb2Udt);
            expect(consumedB(matcher, matcher.match(low))).toBeLessThanOrEqual(
              consumedB(matcher, matcher.match(high)),
            );
          },
        ),
      );
    },
  );

  it.each(DIRECTIONS)(
    "$name: bMaxMatch full-fills to aMin and adjudicates ok",
    ({ isCkb2Udt }) => {
      fc.assert(
        fc.property(orderArb(isCkb2Udt), (order) => {
          const matcher = mustMatcher(order, isCkb2Udt);
          const full = matcher.match(matcher.bMaxMatch);
          expect(full.partials).toHaveLength(1);
          const aOut = isCkb2Udt ? full.partials[0]?.ckbOut : full.partials[0]?.udtOut;
          expect(aOut).toBe(matcher.aMin);
          expect(adjudicate(order, full)).toEqual(["ok"]);
        }),
      );
    },
  );

  it.each(DIRECTIONS)(
    "$name: any allowance below bMinMatch matches nothing",
    ({ isCkb2Udt }) => {
      fc.assert(
        fc.property(orderArb(isCkb2Udt), allowanceArb, (order, allowance) => {
          const matcher = mustMatcher(order, isCkb2Udt);
          // bMinMatch is at least 1, so the remainder always lands below it.
          const below = allowance % matcher.bMinMatch;
          expect(matcher.match(below).partials).toHaveLength(0);
        }),
      );
    },
  );
});

describe("ckb2udt entry.rs:116 post-guard reachability", () => {
  it("admitted partial-band allowances clear the plain-CKB minimum at any fee", () => {
    // The post-guard fires only when a partial moves less than ckbMinMatch
    // plain CKB. This property samples that the bMinMatch pre-gate already
    // excludes that for every admitted allowance, at any fee; the
    // deterministic test below carries the actual unreachability argument.
    fc.assert(
      fc.property(orderAndFeeArb(true), allowanceArb, ({ order, ckbMiningFee }, pick) => {
        const matcher = mustMatcher(order, true, ckbMiningFee);
        const band = matcher.bMaxMatch - matcher.bMinMatch;
        if (band === 0n) {
          return; // Only full fills exist; the partial branch is empty.
        }
        // Probe the exact bMinMatch edge plus a drawn in-band allowance.
        for (const bAllowance of [matcher.bMinMatch, matcher.bMinMatch + (pick % band)]) {
          const match = matcher.match(bAllowance);
          expect(match.partials).toHaveLength(1);
          expect(match.ckbDelta).toBeGreaterThanOrEqual(order.data.info.getCkbMinMatch());
        }
      }),
    );
  });

  // Attempted witness: an allowance the bMinMatch pre-gate admits but the
  // post-guard rejects. None exists, at any fee: ckbMiningFee never enters
  // aOut, bMinMatch, or bMaxMatch (only matcher admission and real-ratio
  // ordering), and in the partial branch the plain CKB delta is
  // floor(bAllowance * udtScale / ckbScale), which is at least ckbMinMatch
  // exactly when bAllowance >= ceil(ckbMinMatch * ckbScale / udtScale) =
  // bMinMatch. The pre-gate is the guard's own bound applied earlier, so the
  // post-guard is dead code. This test pins that equivalence on a concrete
  // fee-bearing order by sweeping every allowance up to the full fill.
  it("the pre-gate rejects exactly the partials the guard protects against", () => {
    const info = Info.create(true, { ckbScale: 2n, udtScale: 1n }, 3); // min 8 CKB
    const order = orderWith({ info, ckbUnoccupied: 10_000n, udtValue: 0n });
    const matcher = mustMatcher(order, true, 1_000n);
    expect(matcher.bMinMatch).toBe(16n); // ceil(8 * 2 / 1)

    // Below the gate the matcher emits nothing, and rightly so: the would-be
    // partial (aOut via the matcher's own nonDecreasing rounding) moves
    // 1..7 CKB and the contract rejects it as an insufficient match.
    for (let bAllowance = 2n; bAllowance < 16n; bAllowance += 1n) {
      expect(matcher.match(bAllowance).partials).toHaveLength(0);
      const bOut = matcher.bIn + bAllowance;
      const aOut =
        (matcher.bScale * (matcher.bIn - bOut) +
          matcher.aScale * (matcher.aIn + 1n) -
          1n) /
        matcher.aScale;
      const wouldBe: Match = {
        ckbDelta: matcher.aIn - aOut,
        udtDelta: matcher.bIn - bOut,
        partials: [{ group: matcher.group, ckbOut: aOut, udtOut: bOut }],
      };
      expect(adjudicate(order, wouldBe)).toEqual(["InsufficientMatch"]);
    }

    // Past the gate the guard never fires: the whole partial band emits, and
    // every partial moves at least the 8-CKB minimum the guard checks for.
    for (let bAllowance = 16n; bAllowance < matcher.bMaxMatch; bAllowance += 1n) {
      const match = matcher.match(bAllowance);
      expect(match.partials).toHaveLength(1);
      expect(match.ckbDelta).toBeGreaterThanOrEqual(8n);
    }
  });
});
