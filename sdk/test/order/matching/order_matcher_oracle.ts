import { describe, expect, it } from "vitest";
import type { OrderCell } from "../../../src/order/cells.ts";
import { Info } from "../../../src/order/info.ts";
import type { OrderMatcher } from "../../../src/order/matcher.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import { adjudicate, mustMatcher, orderWith } from "./support/order_oracle_helpers.ts";

/**
 * Adjudicates every partial the matcher emits against the contract oracle: the
 * on-chain `validate()` must accept it. The oracle is an independent port of the
 * deployed Rust (see `@ickb/testkit` contract_oracle), so agreement here is the
 * ground truth the historical unit-ratio suite could not provide (defect C1).
 */

function infoFrom(options: {
  ckbToUdt?: { ckbScale: bigint; udtScale: bigint };
  udtToCkb?: { ckbScale: bigint; udtScale: bigint };
  ckbMinMatchLog: number;
}): Info {
  return Info.from({
    ckbToUdt:
      options.ckbToUdt === undefined ? Ratio.empty() : Ratio.from(options.ckbToUdt),
    udtToCkb:
      options.udtToCkb === undefined ? Ratio.empty() : Ratio.from(options.udtToCkb),
    ckbMinMatchLog: options.ckbMinMatchLog,
  });
}

/** Sweeps allowances 0..=80, adjudicating every emitted partial; returns the count. */
function adjudicatedSweep(order: OrderCell, matcher: OrderMatcher): number {
  let matched = 0;
  for (let allowance = 0n; allowance <= 80n; allowance += 1n) {
    const match = matcher.match(allowance);
    expect(adjudicate(order, match)).toEqual(match.partials.map(() => "ok"));
    matched += match.partials.length;
  }
  return matched;
}

const REGIMES = [
  { name: "ckbScale above udtScale (C1 regime)", ckbScale: 2n, udtScale: 1n },
  { name: "udtScale above ckbScale", ckbScale: 1n, udtScale: 2n },
  { name: "unit ratio", ckbScale: 1n, udtScale: 1n },
  { name: "coprime asymmetric", ckbScale: 7n, udtScale: 3n },
];

describe("order matcher versus contract oracle", () => {
  it.each(REGIMES)("ckb2udt partials satisfy the contract at $name", (regime) => {
    const info = infoFrom({ ckbToUdt: regime, ckbMinMatchLog: 3 });
    const order = orderWith({ info, ckbUnoccupied: 10_000n, udtValue: 0n });
    expect(adjudicatedSweep(order, mustMatcher(order, true))).toBeGreaterThan(0);
  });

  it.each(REGIMES)("udt2ckb partials satisfy the contract at $name", (regime) => {
    const info = infoFrom({ udtToCkb: regime, ckbMinMatchLog: 3 });
    const order = orderWith({ info, ckbUnoccupied: 0n, udtValue: 10_000n });
    expect(adjudicatedSweep(order, mustMatcher(order, false))).toBeGreaterThan(0);
  });

  it("pins the C1 counterexample: min 8 CKB at 2:1 requires 16 UDT, not 4", () => {
    const info = infoFrom({
      ckbToUdt: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 3,
    });
    const order = orderWith({ info, ckbUnoccupied: 10_000n, udtValue: 0n });
    const matcher = mustMatcher(order, true);

    // The buggy conversion yielded bMinMatch = ceil(8*1/2) = 4, emitting a
    // 2-CKB partial the deployed script rejects with InsufficientMatch.
    expect(matcher.bMinMatch).toBe(16n);
    expect(matcher.match(4n).partials).toHaveLength(0);
    const first = matcher.match(16n);
    expect(first.partials).toHaveLength(1);
    expect(first.ckbDelta).toBeGreaterThanOrEqual(8n);
    expect(adjudicate(order, first)).toEqual(["ok"]);
  });

  it("is not over-restrictive in the inverse regime: min 8 CKB at 1:2 needs only 4 UDT", () => {
    const info = infoFrom({
      ckbToUdt: { ckbScale: 1n, udtScale: 2n },
      ckbMinMatchLog: 3,
    });
    const order = orderWith({ info, ckbUnoccupied: 10_000n, udtValue: 0n });
    const matcher = mustMatcher(order, true);

    expect(matcher.bMinMatch).toBe(4n);
    const first = matcher.match(4n);
    expect(first.partials).toHaveLength(1);
    expect(first.ckbDelta).toBeGreaterThanOrEqual(8n);
    expect(adjudicate(order, first)).toEqual(["ok"]);
  });

  it("full fills bypass the minimum-match rule, as on-chain", () => {
    const info = infoFrom({
      ckbToUdt: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 6,
    });
    const order = orderWith({ info, ckbUnoccupied: 7n, udtValue: 0n });
    const matcher = mustMatcher(order, true);

    // The whole order is smaller than ckbMinMatch (64); only a full fill is legal.
    const full = matcher.match(matcher.bMaxMatch);
    expect(full.partials).toHaveLength(1);
    expect(adjudicate(order, full)).toEqual(["ok"]);
  });
});
