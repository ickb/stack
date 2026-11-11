import { ccc } from "@ckb-ccc/core";
import type { StubCell, StubTransactionRecord } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  byte32FromByte,
  capacityCell,
  committedTransactionResponse,
  composedClient,
  GENESIS_HEADERS,
  genesisHeader,
  headerLike,
  offlineTestnetClient,
  outPoint,
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
  it("creates committed responses", () => {
    const tx = ccc.Transaction.from({ outputs: [] });
    const response = committedTransactionResponse(tx, { blockNumber: 7n });

    expect(response.transaction.hash()).toBe(tx.hash());
    expect(response.status).toBe("committed");
    expect(response.blockNumber).toBe(7n);
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

  it("delegates transaction and header handlers", async () => {
    const transaction = committedTransactionResponse(ccc.Transaction.default());
    const withHeader = transactionWithHeader(headerLike({ number: 3n }));
    const header = headerLike({ number: 4n });
    const client = new StubClient({
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

    await expect(client.getTransaction(byte32FromByte("99"))).resolves.toBe(transaction);
    await expect(client.getTransactionWithHeader(byte32FromByte("99"))).resolves.toBe(
      withHeader,
    );
    await expect(client.getHeaderByNumber(4n)).resolves.toBe(header);
  });
});

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

describe("StubClient network boundary", () => {
  it("refuses paged cell scans when no handler was configured", async () => {
    const client = new StubClient({});
    const searchKey = {
      script: script("11"),
      scriptType: "lock",
      scriptSearchMode: "exact",
    } as const;

    await expect(client.findCellsPaged(searchKey, "asc", 1)).rejects.toThrow(
      "Offline test client received get_cells",
    );
  });

  it("answers header 0 with the real testnet genesis and no other header", async () => {
    const client = new StubClient({});

    await expect(client.getHeaderByNumber(0n)).resolves.toEqual(genesisHeader("testnet"));
    await expect(client.getHeaderByNumber(1n)).rejects.toThrow(
      "Offline test client received get_header_by_number",
    );
    // Only the header read answers for block 0.
    await expect(client.getBlockByNumber(0n)).rejects.toThrow(
      "Offline test client received get_block_by_number",
    );
    expect(genesisHeader("testnet").hash).toBe(GENESIS_HEADERS.testnet.hash);
    expect(genesisHeader("mainnet").hash).toBe(GENESIS_HEADERS.mainnet.hash);
  });

  it("keeps the offline client off the network", async () => {
    await expect(offlineTestnetClient().getTipHeader()).rejects.toThrow(
      "Offline test client received get_tip_header",
    );
  });

  it("answers only the status poll from transactionStatus, unknown when it has none", async () => {
    const hash = byte32FromByte("99");
    const scripted = new StubClient({
      cells: (): readonly StubCell[] => [],
      transactionStatus: async (txHash): Promise<{ status: string } | undefined> => {
        await Promise.resolve();
        return txHash === hash ? { status: "committed" } : undefined;
      },
    });
    const request = async (
      client: StubClient,
      method: string,
      params: unknown[],
    ): Promise<unknown> => client.requestor.request(method, params);

    await expect(request(scripted, "get_transaction", [hash])).resolves.toEqual({
      transaction: null,
      tx_status: { status: "committed" },
    });
    await expect(
      request(scripted, "get_transaction", [byte32FromByte("88")]),
    ).resolves.toMatchObject({ tx_status: { status: "unknown" } });
    for (const [client, method, params] of [
      [scripted, "get_transaction", []],
      [scripted, "get_header", [hash]],
      [new StubClient({}), "get_transaction", [hash]],
    ] as const) {
      await expect(request(client, method, [...params])).rejects.toThrow(
        `Offline test client received ${method}`,
      );
    }
  });
});

describe("StubClient cells", () => {
  it("serves raw get_cells pages, the cursor counting what was served, blocks as named", async () => {
    const first = capacityCell(1n, script("44"), "11");
    const second = capacityCell(1n, script("44"), "22");
    const third = capacityCell(1n, script("44"), "33");
    const keys: unknown[] = [];
    const client = new StubClient({
      cells: (key): readonly StubCell[] => {
        keys.push(key);
        return [first, { cell: second, blockNumber: 7n }, third];
      },
    });
    const key = { script: { code_hash: script("44").codeHash } };

    interface Page {
      last_cursor: string;
      objects: Array<{ block_number: string; out_point: { tx_hash: string } }>;
    }
    const read = async (after: string | null): Promise<Page> =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the stub's own raw answer.
      (await client.requestor.request("get_cells", [key, "asc", "0x2", after])) as Page;
    const page = await read(null);
    const rest = await read(page.last_cursor);

    expect(keys).toEqual([key, key]);
    expect(page.last_cursor).toBe("0x2");
    expect(page.objects.map((cell) => cell.block_number)).toEqual(["0x0", "0x7"]);
    expect(rest.objects.map((cell) => cell.out_point.tx_hash)).toEqual([
      third.outPoint.txHash,
    ]);
    expect(rest.last_cursor).toBe("0x3");
  });
});

describe("StubClient transactions", () => {
  it("serves raw grouped get_transactions pages, and none without a handler", async () => {
    const record = (byte: string, isInput: boolean): StubTransactionRecord => ({
      txHash: byte32FromByte(byte),
      blockNumber: 7n,
      txIndex: 2n,
      cells: [{ isInput, cellIndex: 1n }],
    });
    const client = new StubClient({
      transactions: (): readonly StubTransactionRecord[] => [
        record("11", false),
        record("22", true),
        record("33", false),
      ],
    });
    const key = {
      script: script("44"),
      scriptType: "lock",
      scriptSearchMode: "exact",
      groupByTransaction: true,
    } as const;

    const first = await client.findTransactionsPaged(key, "desc", 2);
    const rest = await client.findTransactionsPaged(key, "desc", 2, first.lastCursor);

    expect(first).toEqual({
      lastCursor: "0x2",
      transactions: [record("11", false), record("22", true)],
    });
    expect(rest).toEqual({ lastCursor: "0x3", transactions: [record("33", false)] });
    await expect(
      new StubClient({}).findTransactionsPaged(key, "desc", 2),
    ).rejects.toThrow("Offline test client received get_transactions");
    // The handler answers its own method only.
    await expect(client.getTipHeader()).rejects.toThrow(
      "Offline test client received get_tip_header",
    );
  });
});

describe("composedClient", () => {
  it("is a client but not a JSON-RPC one, and forwards to the inner client", async () => {
    const cell = capacityCell(1n, script("44"), "55");
    const client = composedClient(
      new StubClient({
        getCell: async (): Promise<ccc.Cell | undefined> => {
          await Promise.resolve();
          return cell;
        },
      }),
    );

    expect(client).toBeInstanceOf(ccc.Client);
    expect(client).not.toBeInstanceOf(ccc.ClientJsonRpc);
    await expect(client.getCell(outPoint("66"))).resolves.toBe(cell);
  });
});
