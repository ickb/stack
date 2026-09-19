import { ccc } from "@ckb-ccc/core";
import { offlineTestnetClient } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  asyncBinarySearch,
  binarySearch,
  compareBigInt,
  defaultCellPageSize,
  findCells,
  isPlainCapacityCell,
  unique,
} from "../../src/utils/utils.ts";

describe("compareBigInt", () => {
  it("orders bigint values", () => {
    expect(compareBigInt(1n, 2n)).toBe(-1);
    expect(compareBigInt(2n, 2n)).toBe(0);
    expect(compareBigInt(3n, 2n)).toBe(1);
  });
});

describe("findCells", () => {
  it("collects every page and stops on the first short page", async () => {
    const client = offlineTestnetClient();
    const cell = testCell({ type: undefined, outputData: "0x" });
    const fullPage = Array.from({ length: defaultCellPageSize }, () => cell);
    const afters: Array<string | undefined> = [];
    const noCache = vi
      .spyOn(client, "findCellsPagedNoCache")
      .mockImplementation(async (_key, _order, _limit, after) => {
        afters.push(after);
        await Promise.resolve();
        return after === undefined
          ? { cells: fullPage, lastCursor: "next" }
          : { cells: [cell], lastCursor: "done" };
      });
    const recording = vi
      .spyOn(client, "findCellsPaged")
      .mockRejectedValue(new Error("cache-recording scan used"));

    const cells = await findCells(client, {
      script: cell.cellOutput.lock,
      scriptType: "lock",
      scriptSearchMode: "exact",
    });

    expect(cells).toHaveLength(defaultCellPageSize + 1);
    expect(afters).toEqual([undefined, "next"]);
    expect(noCache).toHaveBeenCalledTimes(2);
    expect(recording).not.toHaveBeenCalled();
  });

  it("completes after an empty first page", async () => {
    const client = offlineTestnetClient();
    const noCache = vi
      .spyOn(client, "findCellsPagedNoCache")
      .mockResolvedValue({ cells: [], lastCursor: "" });

    await expect(
      findCells(client, {
        script: testCell({ type: undefined, outputData: "0x" }).cellOutput.lock,
        scriptType: "lock",
        scriptSearchMode: "exact",
      }),
    ).resolves.toEqual([]);
    expect(noCache).toHaveBeenCalledTimes(1);
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
  txByte = "11",
}: {
  type: ccc.ScriptLike | undefined;
  outputData: ccc.Hex;
  txByte?: string;
}): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: `0x${txByte.repeat(32)}`, index: 0n },
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
