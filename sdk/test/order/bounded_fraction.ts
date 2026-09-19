import { describe, expect, it } from "vitest";
import { greatestBoundedFractionAtMost } from "../../src/order/conversion.ts";
import { minBigInt } from "../../src/utils/index.ts";

const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * The independent oracle: over every denominator q up to the bound, the largest numerator
 * (also bounded) whose fraction stays at or under the target; the greatest of those by
 * cross-multiplication. Exhaustive, so it does not share the loop's reasoning.
 */
function oracle(
  numerator: bigint,
  denominator: bigint,
  maxTerm: bigint,
): { numerator: bigint; denominator: bigint } {
  let best = { numerator: 0n, denominator: 1n };
  for (let q = 1n; q <= maxTerm; q++) {
    const quotient = (numerator * q) / denominator;
    const p = minBigInt(quotient, maxTerm);
    if (p * best.denominator > best.numerator * q) {
      best = { numerator: p, denominator: q };
    }
  }
  return best;
}

function reduced(fraction: { numerator: bigint; denominator: bigint }): {
  numerator: bigint;
  denominator: bigint;
} {
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const divisor = gcd(fraction.numerator, fraction.denominator);
  return {
    numerator: fraction.numerator / divisor,
    denominator: fraction.denominator / divisor,
  };
}

function* smallInputs(): Generator<[bigint, bigint, bigint]> {
  for (let n = 0n; n <= 150n; n++) {
    for (let d = 1n; d <= 150n; d++) {
      for (let m = 1n; m <= 25n; m++) {
        yield [n, d, m];
      }
    }
  }
}

describe("greatestBoundedFractionAtMost", () => {
  it("matches the exhaustive oracle on every small input", () => {
    const mismatches: string[] = [];
    for (const [n, d, m] of smallInputs()) {
      const actual = greatestBoundedFractionAtMost(n, d, m);
      const expected = reduced(oracle(n, d, m));
      if (
        actual.numerator !== expected.numerator ||
        actual.denominator !== expected.denominator
      ) {
        mismatches.push(`${String(n)}/${String(d)} within ${String(m)}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);

  it.each([
    [0n, 7n, 5n, 0n, 1n],
    [2n, 3n, 5n, 2n, 3n],
    [8n, 12n, 5n, 2n, 3n],
    [7n, 3n, 1n, 1n, 1n],
    [1n, 7n, 5n, 0n, 1n],
    [3n, 7n, 5n, 2n, 5n],
    [12n, 5n, 10n, 7n, 3n],
    [5n, 12n, 10n, 2n, 5n],
    [7n, 5n, 3n, 1n, 1n],
  ])("returns %s/%s within %s as %s/%s", (n, d, m, p, q) => {
    expect(greatestBoundedFractionAtMost(n, d, m)).toEqual({
      numerator: p,
      denominator: q,
    });
  });

  it("keeps a fraction that fits the bound exactly", () => {
    expect(greatestBoundedFractionAtMost(MAX_UINT64, 1n, MAX_UINT64)).toEqual({
      numerator: MAX_UINT64,
      denominator: 1n,
    });
    expect(greatestBoundedFractionAtMost(1n, MAX_UINT64, MAX_UINT64)).toEqual({
      numerator: 1n,
      denominator: MAX_UINT64,
    });
  });

  it("stays at or under the target on Uint128-scale amounts, with terms within the bound", () => {
    const cases = [
      [(1n << 100n) + 12_345n, (1n << 90n) + 6_789n],
      [(1n << 90n) + 6_789n, (1n << 100n) + 12_345n],
      [(1n << 127n) - 1n, 3n],
      [1n, (1n << 127n) - 1n],
      // Consecutive Fibonacci numbers: the slowest-converging continued fraction.
      [1_100_087_778_366_101_931n, 679_891_637_638_612_258n],
    ] as const;
    for (const [n, d] of cases) {
      const { numerator, denominator } = greatestBoundedFractionAtMost(n, d, MAX_UINT64);
      expect(numerator).toBeLessThanOrEqual(MAX_UINT64);
      expect(denominator).toBeLessThanOrEqual(MAX_UINT64);
      expect(denominator).toBeGreaterThan(0n);
      expect(numerator * d).toBeLessThanOrEqual(n * denominator);
    }
  });
});
