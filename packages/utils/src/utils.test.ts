import { describe, expect, it } from "vitest";
import {
  BufferedGenerator,
  compareBigInt,
  collectPagedScan,
} from "./utils.js";

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

describe("scan collection", () => {
  it("passes the cell page size through and collects all yielded items", async () => {
    const seenPageSizes: number[] = [];

    await expect(collectPagedScan(
      async function* (pageSize: number) {
        seenPageSizes.push(pageSize);
        yield 1;
        yield 2;
        await Promise.resolve();
      },
      { pageSize: 2 },
    )).resolves.toEqual([1, 2]);
    expect(seenPageSizes).toEqual([2]);
  });
});
