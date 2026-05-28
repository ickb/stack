import { describe, expect, it } from "vitest";
import { ccc } from "@ckb-ccc/core";
import {
  BufferedGenerator,
  assertCompleteScan,
  compareBigInt,
  collectCompleteScan,
  scanLimit,
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

describe("scan completeness", () => {
  it("derives the sentinel scan limit", () => {
    expect(scanLimit(400)).toBe(401);
  });

  it("allows scans up to the logical limit", () => {
    expect(() => {
      assertCompleteScan(400, 400, "account");
    }).not.toThrow();
  });

  it("fails closed after the logical limit", () => {
    expect(() => {
      assertCompleteScan(401, 400, "account");
    }).toThrow(
      "account scan reached limit 400; state may be incomplete",
    );
  });

  it("includes script context in scan errors", () => {
    const lock = ccc.Script.from({
      codeHash: `0x${"11".repeat(32)}`,
      hashType: "type",
      args: "0x",
    });

    expect(() => {
      assertCompleteScan(401, 400, "account", lock);
    }).toThrow(
      `account scan reached limit 400 for ${lock.toHex()}; state may be incomplete`,
    );
  });

  it("includes string context in scan errors", () => {
    expect(() => {
      assertCompleteScan(401, 400, "account", " for wallet");
    }).toThrow(
      "account scan reached limit 400 for wallet; state may be incomplete",
    );
  });

  it("collects scans with a sentinel limit", async () => {
    const seenLimits: number[] = [];

    await expect(collectCompleteScan(
      async function* (limit: number) {
        seenLimits.push(limit);
        yield 1;
        yield 2;
        await Promise.resolve();
      },
      { limit: 2, label: "account" },
    )).resolves.toEqual([1, 2]);
    expect(seenLimits).toEqual([3]);
  });

  it("fails closed when collected sentinel scans exceed the logical limit", async () => {
    await expect(collectCompleteScan(
      async function* () {
        yield 1;
        yield 2;
        await Promise.resolve();
      },
      { limit: 1, label: "account" },
    )).rejects.toThrow(
      "account scan reached limit 1; state may be incomplete",
    );
  });
});
