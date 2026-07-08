import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import {
  asyncBinarySearch,
  binarySearch,
  BufferedGenerator,
  collect,
  collectPagedScan,
  compareBigInt,
  isPlainCapacityCell,
  unique,
} from "../src/utils.ts";

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

  it("stops initial buffering when the wrapped generator is exhausted", () => {
    function* oneNumber(): Generator<number, void, void> {
      yield 1;
    }

    const buffered = new BufferedGenerator(oneNumber(), 3);

    expect(buffered.buffer).toEqual([1]);
  });
});

describe("scan collection", () => {
  it("passes the cell page size through and collects all yielded items", async () => {
    const seenPageSizes: number[] = [];

    await expect(
      collectPagedScan(
        async function* (pageSize: number): AsyncGenerator<number> {
          seenPageSizes.push(pageSize);
          yield 1;
          yield 2;
          await Promise.resolve();
        },
        { pageSize: 2 },
      ),
    ).resolves.toEqual([1, 2]);
    expect(seenPageSizes).toEqual([2]);
  });

  it("rejects invalid page sizes before creating the scan", async () => {
    const scan = vi.fn((): AsyncIterable<number> => {
      throw new Error("scan factory should not be called");
    });

    for (const pageSize of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(collectPagedScan(scan, { pageSize })).rejects.toThrow(
        "pageSize must be a positive safe integer",
      );
    }
    expect(scan).not.toHaveBeenCalled();
  });

  it("collects async iterable values", async () => {
    await expect(
      collect(
        (async function* (): AsyncGenerator<string> {
          yield "a";
          await Promise.resolve();
          yield "b";
        })(),
      ),
    ).resolves.toEqual(["a", "b"]);
  });
});

describe("isPlainCapacityCell", () => {
  it("accepts cells without a type script or data", () => {
    const cell = testCell({ type: undefined, outputData: "0x" });

    expect(isPlainCapacityCell(cell)).toBe(true);
  });

  it("rejects typed cells and data-carrying cells", () => {
    const typed = testCell({
      type: { codeHash: "0x", hashType: "type", args: "0x" },
      outputData: "0x",
    });
    const dataCarrying = testCell({ type: undefined, outputData: "0x01" });

    expect(isPlainCapacityCell(typed)).toBe(false);
    expect(isPlainCapacityCell(dataCarrying)).toBe(false);
  });
});

describe("binary search helpers", () => {
  it("finds the first matching index", () => {
    expect(binarySearch(8, (index) => index >= 5)).toBe(5);
  });

  it("returns the range end when no index matches", () => {
    expect(binarySearch(4, () => false)).toBe(4);
  });

  it("finds the first matching index asynchronously", async () => {
    await expect(
      asyncBinarySearch(8, async (index) => {
        await Promise.resolve();
        return index >= 3;
      }),
    ).resolves.toBe(3);
  });
});

describe("unique", () => {
  it("yields only the first entity for each hex key", () => {
    const first = hexEntity("0x01");
    const duplicate = hexEntity("0x01");
    const second = hexEntity("0x02");

    expect([...unique([first, duplicate, second])]).toEqual([first, second]);
  });
});

function testCell({
  type,
  outputData,
}: {
  type: ccc.ScriptLike | undefined;
  outputData: ccc.Hex;
}): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: `0x${"11".repeat(32)}`, index: 0n },
    cellOutput: {
      capacity: 0n,
      lock: { codeHash: `0x${"22".repeat(32)}`, hashType: "type", args: "0x" },
      type,
    },
    outputData,
  });
}

function hexEntity(value: ccc.Hex): ccc.Entity {
  return new TestEntity(value);
}

class TestEntity extends ccc.Entity {
  private readonly value: ccc.Hex;

  constructor(value: ccc.Hex) {
    super();
    this.value = value;
  }

  public override hash(): ccc.Hex {
    return ccc.hashCkb(this.value);
  }

  public override toBytes(): ccc.Bytes {
    return ccc.bytesFrom(this.value);
  }

  public override toHex(): ccc.Hex {
    return this.value;
  }

  public override clone(): TestEntity {
    return new TestEntity(this.value);
  }
}
