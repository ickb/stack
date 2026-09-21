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
 * for example `VITEST_FC_SEED=42 pnpm vitest run sdk`.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { OrderCell } from "../../../src/order/cells.ts";
import { Info } from "../../../src/order/info.ts";
import { type Match, OrderMatcher } from "../../../src/order/matcher.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import { resolvedOrderGroup } from "./support/order_match_helpers.ts";
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
        info: Info.from({
          ckbToUdt: isCkb2Udt ? ratio : Ratio.empty(),
          udtToCkb: isCkb2Udt ? Ratio.empty() : ratio,
          ckbMinMatchLog,
        }),
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

describe("dual orders", () => {
  it("never gain in both directions at one exchange rate", () => {
    // Info.validate rejects a dual whose ratios let value be extracted, so a matcher that
    // only takes gaining fills can never fill both directions of one cell.
    fc.assert(
      fc.property(
        ratioArb,
        ratioArb,
        ratioArb,
        fc.integer({ min: 0, max: 20 }),
        fc.bigInt({ min: 1n, max: MAX_AMOUNT }),
        fc.bigInt({ min: 1n, max: MAX_AMOUNT }),
        feeArb,
        allowanceArb,
        (
          ckbToUdt,
          udtToCkb,
          rate,
          ckbMinMatchLog,
          ckbUnoccupied,
          udtValue,
          fee,
          pick,
        ) => {
          const info = Info.from({ ckbToUdt, udtToCkb, ckbMinMatchLog });
          fc.pre(isValid(info));
          const order = orderWith({ info, ckbUnoccupied, udtValue });
          const gains = [true, false].map((isCkb2Udt) => {
            const matcher = OrderMatcher.from(resolvedOrderGroup(order), isCkb2Udt, fee);
            if (matcher === undefined) {
              return 0n;
            }
            const band = matcher.bMaxMatch - matcher.bMinMatch;
            const fill = matcher.match(matcher.bMinMatch + (pick % (band + 1n)));
            return (
              (fill.ckbDelta - fee * BigInt(fill.partials.length)) * rate.ckbScale +
              fill.udtDelta * rate.udtScale
            );
          });
          expect(gains.every((gain) => gain > 0n)).toBe(false);
        },
      ),
    );
  });
});

describe("minimum match pre-gate", () => {
  it.each(DIRECTIONS)(
    "$name: every allowance from bMinMatch up to the whole fill matches one valid partial",
    ({ isCkb2Udt }) => {
      // The pre-gate is the contract's own minimum on the value moved, so nothing the
      // gate admits is rejected later; the seller side rounds the CKB minimum up to the
      // ratio's grid for that.
      fc.assert(
        fc.property(
          orderAndFeeArb(isCkb2Udt),
          allowanceArb,
          ({ order, ckbMiningFee }, pick) => {
            const matcher = mustMatcher(order, isCkb2Udt, ckbMiningFee);
            const band = matcher.bMaxMatch - matcher.bMinMatch;
            for (const bAllowance of [
              matcher.bMinMatch,
              matcher.bMinMatch + (pick % (band + 1n)),
            ]) {
              const match = matcher.match(bAllowance);
              expect(match.partials).toHaveLength(1);
              expect(adjudicate(order, match)).toEqual(["ok"]);
            }
          },
        ),
      );
    },
  );

  it("rounds a seller's minimum up to the first payment whose UDT covers it", () => {
    // Three CKB buy one UDT; a minimum of one CKB moves no whole UDT, so the first
    // payment the contract accepts is three CKB.
    const info = Info.from({
      ckbToUdt: Ratio.empty(),
      udtToCkb: { ckbScale: 1n, udtScale: 3n },
      ckbMinMatchLog: 0,
    });
    const order = orderWith({ info, ckbUnoccupied: 0n, udtValue: 1_000n });
    const matcher = mustMatcher(order, false);
    expect(matcher.bMinMatch).toBe(3n);
    expect(matcher.match(2n).partials).toHaveLength(0);
    expect(adjudicate(order, matcher.match(3n))).toEqual(["ok"]);
  });
});

/** Whether the entity's own `validate` accepts it: the property's precondition. */
function isValid(entity: { validate: () => void }): boolean {
  try {
    entity.validate();
    return true;
  } catch {
    return false;
  }
}
