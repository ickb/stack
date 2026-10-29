import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import { composedClient, offlineTestnetClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  asyncBinarySearch,
  compareBigInt,
  defaultCellPageSize,
  findCells,
  isPlainCapacityCell,
  jsonRpcRequestor,
  unique,
} from "../../src/utils/utils.ts";

describe("jsonRpcRequestor", () => {
  it("finds the requestor on a JSON-RPC client and through the connector's proxy", () => {
    const client = offlineTestnetClient();

    expect(jsonRpcRequestor(client)).toBe(client.requestor);
    expect(jsonRpcRequestor(composedClient(client))).toBe(client.requestor);
  });

  it("refuses a client without one, or with another kind of requestor", () => {
    for (const shape of [{}, { requestor: {} }]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- Only the requestor field is inspected.
      expect(() => jsonRpcRequestor(shape as unknown as ccc.Client)).toThrow(
        "The SDK needs a JSON-RPC client",
      );
    }
  });
});

describe("compareBigInt", () => {
  it("orders bigint values", () => {
    expect(compareBigInt(1n, 2n)).toBe(-1);
    expect(compareBigInt(2n, 2n)).toBe(0);
    expect(compareBigInt(3n, 2n)).toBe(1);
  });
});

/** A client whose node answers `get_cells` pages, block 5 for every cell, and nothing else. */
function cellsClient(
  page: (after: string | null) => { cells: ccc.Cell[]; lastCursor: string },
): { client: ccc.Client; afters: Array<string | null>; limits: ccc.Hex[] } {
  const afters: Array<string | null> = [];
  const limits: ccc.Hex[] = [];
  const client = ccc.ClientPublicTestnet.new({
    transport: {
      request: async (payload): Promise<ccc.JsonRpcResponse> => {
        await Promise.resolve();
        if (payload.method !== "get_cells") {
          throw new Error(`Unexpected ${payload.method}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the SDK sends the cursor fourth.
        const [, , limit, after = null] = payload.params as [
          unknown,
          unknown,
          ccc.Hex,
          string | null | undefined,
        ];
        limits.push(limit);
        afters.push(after);
        const { cells, lastCursor } = page(after);
        return {
          id: payload.id,
          jsonrpc: "2.0",
          result: {
            last_cursor: lastCursor,
            objects: cells.map((cell) => ({
              out_point: cccA.JsonRpcTransformers.outPointFrom(cell.outPoint),
              output: cccA.JsonRpcTransformers.cellOutputFrom(cell.cellOutput),
              // A node leaves the data out when a scan does not ask for it.
              ...(cell.outputData === "0x" ? {} : { output_data: cell.outputData }),
              block_number: "0x5",
              tx_index: "0x0",
            })),
          },
        };
      },
    },
  });
  return { client, afters, limits };
}

describe("findCells", () => {
  const cell = testCell({ type: undefined, outputData: "0x" });
  const key = {
    script: cell.cellOutput.lock,
    scriptType: "lock",
    scriptSearchMode: "exact",
  } as const;

  it("collects every page with each cell's block and stops on the first short page", async () => {
    const fullPage = Array.from({ length: defaultCellPageSize }, () => cell);
    const { client, afters, limits } = cellsClient((after) =>
      after === null
        ? { cells: fullPage, lastCursor: "0x01" }
        : { cells: [cell], lastCursor: "0x02" },
    );

    const cells = await findCells(client, key);

    expect(cells).toHaveLength(defaultCellPageSize + 1);
    expect(cells[0]?.blockNumber).toBe(5n);
    expect(cells[0]?.cell.outPoint.eq(cell.outPoint)).toBe(true);
    expect(afters).toEqual([null, "0x01"]);
    expect(limits).toEqual([
      ccc.numToHex(defaultCellPageSize),
      ccc.numToHex(defaultCellPageSize),
    ]);
  });

  it("fails when a full page brings the cursor back unchanged", async () => {
    // A non-empty page always moves the indexer's cursor; a node that repeats it would
    // otherwise be read for ever.
    const fullPage = Array.from({ length: defaultCellPageSize }, () => cell);
    const { client, afters } = cellsClient((after) => ({
      cells: fullPage,
      lastCursor: after ?? "0x01",
    }));

    await expect(findCells(client, key)).rejects.toThrow(
      "Cell scan cursor did not advance",
    );
    expect(afters).toHaveLength(2);
  });

  it("completes after an empty first page", async () => {
    const { client, afters } = cellsClient(() => ({ cells: [], lastCursor: "0x" }));

    await expect(findCells(client, key)).resolves.toEqual([]);
    expect(afters).toHaveLength(1);
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
