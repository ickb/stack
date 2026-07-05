import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import {
  asyncPassthroughTransaction,
  byte32FromByte,
  capacityCell,
  committedTransactionResponse,
  headerLike,
  outPoint,
  passthroughTransaction,
  script,
  StubClient,
  transactionWithHeader,
} from "../src/index.ts";

describe("byte32FromByte", () => {
  it("creates a repeated 32-byte hex string", () => {
    expect(byte32FromByte("ab")).toBe(`0x${"ab".repeat(32)}`);
  });

  it("rejects non-byte hex input", () => {
    expect(() => byte32FromByte("abc")).toThrow("Expected exactly one byte");
  });
});

describe("cell fixtures", () => {
  it("creates reusable scripts, out points, and capacity cells", () => {
    const lock = script("11", "0x1234");
    const capacity = ccc.fixedPointFrom(100);
    const cell = capacityCell(capacity, lock, "22");

    expect(lock.codeHash).toBe(byte32FromByte("11"));
    expect(lock.hashType).toBe("type");
    expect(lock.args).toBe("0x1234");
    expect(outPoint("33", 2n).toHex()).toBe(`${byte32FromByte("33")}02000000`);
    expect(cell.cellOutput.capacity).toBe(capacity);
    expect(cell.cellOutput.lock.eq(lock)).toBe(true);
    expect(cell.outputData).toBe("0x");
  });
});

describe("transaction fixtures", () => {
  it("normalizes transactions and committed responses", () => {
    const tx = passthroughTransaction({ outputs: [] });
    const response = committedTransactionResponse(tx, { blockNumber: 7n });

    expect(tx).toBeInstanceOf(ccc.Transaction);
    expect(response.transaction.hash()).toBe(tx.hash());
    expect(response.status).toBe("committed");
    expect(response.blockNumber).toBe(7n);
  });

  it("normalizes transactions asynchronously", async () => {
    await expect(asyncPassthroughTransaction({ outputs: [] })).resolves.toBeInstanceOf(
      ccc.Transaction,
    );
  });

  it("creates transaction-with-header fixtures", () => {
    const header = headerLike({ number: 9n });
    const result = transactionWithHeader(header);

    expect(result.header.number).toBe(9n);
    expect(result.transaction.status).toBe("committed");
  });
});

describe("StubClient", () => {
  it("delegates configured handlers", async () => {
    const cell = capacityCell(1n, script("44"), "55");
    const getCell = vi.fn(async (): Promise<ccc.Cell | undefined> => {
      await Promise.resolve();
      return cell;
    });
    const client = new StubClient({ addressPrefix: "ckt", getCell });

    await expect(client.getCell(outPoint("66"))).resolves.toBe(cell);
    expect(client.addressPrefix).toBe("ckt");
    expect(getCell).toHaveBeenCalledTimes(1);
  });

  it("keeps default fallback handlers and cache overrides", () => {
    const cache = new TestCache();
    const client = new StubClient({ cache });

    expect(client.cache).toBe(cache);
    expect(client.addressPrefix).toBe("ckt");
  });

  it("assigns constructor handlers for declared client methods", async () => {
    const tip = headerLike({ number: 11n });
    const sendTransactionDry: ccc.Client["sendTransactionDry"] = vi.fn(
      async (): ReturnType<ccc.Client["sendTransactionDry"]> => {
        await Promise.resolve();
        return 0n;
      },
    );
    const getTipHeader = vi.fn(async (): Promise<ccc.ClientBlockHeader> => {
      await Promise.resolve();
      return tip;
    });
    const client = new StubClient({ getTipHeader, sendTransactionDry });

    await expect(client.getTipHeader()).resolves.toBe(tip);
    expect(client.sendTransactionDry).toBe(sendTransactionDry);
  });

  it("delegates scan and transaction handlers", async () => {
    const cell = capacityCell(1n, script("77"), "88");
    const transaction = committedTransactionResponse(ccc.Transaction.default());
    const withHeader = transactionWithHeader(headerLike({ number: 3n }));
    const header = headerLike({ number: 4n });
    const client = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield cell;
      },
      async *findCellsOnChain(): ReturnType<ccc.Client["findCellsOnChain"]> {
        await Promise.resolve();
        yield cell;
      },
      getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
        await Promise.resolve();
        return transaction;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return withHeader;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return header;
      },
    });

    const searchKey = {
      script: script("aa"),
      scriptType: "lock",
      scriptSearchMode: "exact",
    } as const;

    await expect(collect(client.findCells(searchKey, "asc", 1))).resolves.toEqual([cell]);
    await expect(collect(client.findCellsOnChain(searchKey, "asc", 1))).resolves.toEqual([
      cell,
    ]);
    await expect(client.getTransaction(byte32FromByte("99"))).resolves.toBe(transaction);
    await expect(client.getTransactionWithHeader(byte32FromByte("99"))).resolves.toBe(
      withHeader,
    );
    await expect(client.getHeaderByNumber(4n)).resolves.toBe(header);
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) {
    values.push(value);
  }
  return values;
}

class TestCache extends ccc.ClientCache {
  public override async markUsableNoCache(): Promise<void> {
    await Promise.resolve();
  }

  public override async markUnusable(): Promise<void> {
    await Promise.resolve();
  }

  public override async isUnusable(): Promise<boolean> {
    await Promise.resolve();
    return false;
  }

  public override async clear(): Promise<void> {
    await Promise.resolve();
  }

  public override async *findCells(): AsyncGenerator<ccc.Cell> {
    const cells: ccc.Cell[] = [];
    yield* cells;
    await Promise.resolve();
  }
}
