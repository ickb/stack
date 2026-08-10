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
import type { Match } from "../../src/matching/match_types.ts";
import type { OrderMatcher } from "../../src/matching/order_matcher.ts";
import type { OrderCell } from "../../src/model/cells.ts";
import { Info } from "../../src/model/info.ts";
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

/** Orders guaranteed matchable in the requested direction (ckbMiningFee 0n). */
function orderArb(isCkb2Udt: boolean): fc.Arbitrary<OrderCell> {
  return fc
    .record({
      ratio: ratioArb,
      ckbMinMatchLog: fc.integer({ min: 0, max: 20 }),
      ckbUnoccupied: fc.bigInt({ min: isCkb2Udt ? 1n : 0n, max: MAX_AMOUNT }),
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
    "$name: every emitted partial satisfies the contract",
    ({ isCkb2Udt }) => {
      fc.assert(
        fc.property(
          orderArb(isCkb2Udt),
          allowanceArb,
          fc.bigInt({ min: 0n, max: 3n }),
          (order, allowance, boundaryOffset) => {
            const matcher = mustMatcher(order, isCkb2Udt);
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
