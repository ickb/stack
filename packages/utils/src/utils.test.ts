import { describe, expect, it } from "vitest";
import { BufferedGenerator, compareBigInt, selectBoundedUdtSubset } from "./utils.js";

describe("compareBigInt", () => {
  it("orders bigint values", () => {
    expect(compareBigInt(1n, 2n)).toBe(-1);
    expect(compareBigInt(2n, 2n)).toBe(0);
    expect(compareBigInt(3n, 2n)).toBe(1);
  });
});

describe("BufferedGenerator", () => {
  it("keeps advancing the wrapped generator after the initial fill", () => {
    function* numbers(): Generator<number, void, void> {
      yield 1;
      yield 2;
      yield 3;
    }

    const buffered = new BufferedGenerator(numbers(), 2);

    expect(buffered.buffer).toEqual([1, 2]);

    buffered.next(1);
    expect(buffered.buffer).toEqual([2, 3]);

    buffered.next(1);
    expect(buffered.buffer).toEqual([3]);
  });
});

describe("selectBoundedUdtSubset", () => {
  it("finds an exact-count subset when the greedy path fails", () => {
    const deposits = [{ udtValue: 6n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectBoundedUdtSubset(deposits, 10n, {
      candidateLimit: 32,
      minCount: 2,
      maxCount: 2,
    })).toEqual([deposits[1], deposits[2]]);
  });

  it("finds the fullest non-empty subset up to the count limit", () => {
    const deposits = [{ udtValue: 4n }, { udtValue: 7n }, { udtValue: 3n }];

    expect(selectBoundedUdtSubset(deposits, 10n, {
      candidateLimit: 32,
      minCount: 1,
      maxCount: 32,
    })).toEqual([deposits[1], deposits[2]]);
  });

  it("keeps earlier-ranked deposits when equally full subsets tie", () => {
    const firstSix = { udtValue: 6n };
    const firstFour = { udtValue: 4n };
    const secondSix = { udtValue: 6n };
    const secondFour = { udtValue: 4n };

    expect(selectBoundedUdtSubset(
      [firstSix, firstFour, secondSix, secondFour],
      10n,
      {
        candidateLimit: 32,
        minCount: 1,
        maxCount: 32,
      },
    )).toEqual([firstSix, firstFour]);
  });

  it("bounds the search to the requested candidate limit", () => {
    const deposits = [
      ...Array.from({ length: 32 }, () => ({ udtValue: 6n })),
      { udtValue: 5n },
      { udtValue: 5n },
    ];

    expect(selectBoundedUdtSubset(deposits, 10n, {
      candidateLimit: 32,
      minCount: 2,
      maxCount: 2,
    })).toEqual([]);
  });
});
