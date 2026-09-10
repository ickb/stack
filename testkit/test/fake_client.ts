import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  byte32FromByte,
  capacityCell,
  chainState,
  FakeClient,
  FakeClientError,
  headerLike,
  outPoint,
  script,
} from "../src/index.ts";

const aliceLock = script("aa", "0x0a");
const bobLock = script("bb", "0x0b");
const udtType = script("cc");

function lockKey(lock: ccc.Script, type?: ccc.Script): ccc.ClientIndexerSearchKeyLike {
  return {
    script: lock,
    scriptType: "lock",
    scriptSearchMode: "exact",
    filter: type === undefined ? undefined : { script: type },
  };
}

function stateCell(
  txHashByte: string,
  lock: ccc.Script,
  type?: ccc.Script,
  outputData: ccc.HexLike = "0x",
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: outPoint(txHashByte),
    cellOutput: { capacity: ccc.fixedPointFrom(100), lock, type },
    outputData,
  });
}

function spendTx(
  input: ccc.Cell,
  fee: bigint,
  lock: ccc.Script,
  outputsData: ccc.HexLike[] = [],
): ccc.Transaction {
  return ccc.Transaction.from({
    inputs: [{ previousOutput: input.outPoint }],
    outputs: [{ capacity: input.cellOutput.capacity - fee, lock }],
    outputsData,
  });
}

function scripted<T>(value: T): () => Promise<T> {
  return async (): Promise<T> => {
    await Promise.resolve();
    return value;
  };
}

/** Collects cell pages while enforcing the cursor-progress scan contract. */
async function pageCells(
  client: FakeClient,
  key: ccc.ClientIndexerSearchKeyLike,
  pageSize: number,
  order: "asc" | "desc" = "asc",
): Promise<{ cells: ccc.Cell[]; pageSizes: number[]; cursors: string[] }> {
  const cells: ccc.Cell[] = [];
  const pageSizes: number[] = [];
  const cursors: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await client.findCellsPaged(key, order, pageSize, after);
    cells.push(...page.cells);
    pageSizes.push(page.cells.length);
    if (page.cells.length < pageSize) {
      return { cells, pageSizes, cursors };
    }
    if (
      page.lastCursor === "" ||
      page.lastCursor === after ||
      cursors.includes(page.lastCursor)
    ) {
      throw new Error(`Paged scan returned a non-advancing cursor: ${page.lastCursor}`);
    }
    cursors.push(page.lastCursor);
    after = page.lastCursor;
  }
}

describe("FakeClient unscripted members", () => {
  it("rejects unscripted members with FakeClientError", async () => {
    const client = new FakeClient(chainState());
    let caught: unknown;
    try {
      await client.getBlockByNumberNoCache(0n);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FakeClientError);
    if (!(caught instanceof FakeClientError)) {
      throw new Error("expected a FakeClientError rejection");
    }
    expect(caught.name).toBe("FakeClientError");
    expect(caught.message).toBe("getBlockByNumberNoCache is not scripted");
    await expect(client.getTip()).rejects.toThrow("getTip is not scripted");
    await expect(client.getTipHeader()).rejects.toThrow("getTipHeader is not scripted");
    await expect(client.getBlockByHashNoCache(byte32FromByte("01"))).rejects.toThrow(
      "getBlockByHashNoCache is not scripted",
    );
    await expect(client.findTransactionsPaged(lockKey(aliceLock))).rejects.toThrow(
      "findTransactionsPaged is not scripted",
    );
    await expect(client.getKnownScript(ccc.KnownScript.XUdt)).rejects.toThrow(
      "getKnownScript(XUdt) is not scripted",
    );
  });
});

describe("FakeClient indexer queries", () => {
  it("filters declaratively added cells by lock and type scripts", async () => {
    const pure = capacityCell(ccc.fixedPointFrom(100), aliceLock, "01");
    const typed = stateCell("02", aliceLock, udtType, "0x1234");
    const other = stateCell("03", bobLock);
    const wrongType = stateCell("04", aliceLock, script("ee"));
    const client = new FakeClient(
      chainState().cell(pure).cell(typed).cell(other).cell(wrongType),
    );

    const byLock = await pageCells(client, lockKey(aliceLock), 10);
    expect(byLock.cells.map((cell) => cell.outPoint.txHash)).toEqual([
      pure.outPoint.txHash,
      typed.outPoint.txHash,
      wrongType.outPoint.txHash,
    ]);
    const byLockAndType = await pageCells(client, lockKey(aliceLock, udtType), 10);
    expect(byLockAndType.cells.map((cell) => cell.outPoint.txHash)).toEqual([
      typed.outPoint.txHash,
    ]);
    const byType = await pageCells(
      client,
      { script: udtType, scriptType: "type", scriptSearchMode: "exact" },
      10,
    );
    expect(byType.cells.map((cell) => cell.outPoint.txHash)).toEqual([
      typed.outPoint.txHash,
    ]);
    const bare = await pageCells(client, { ...lockKey(aliceLock), withData: false }, 10);
    expect(bare.cells.map((cell) => cell.outputData)).toEqual(["0x", "0x", "0x"]);
    await expect(client.getBalanceSingle(aliceLock)).resolves.toBe(
      pure.cellOutput.capacity,
    );
  });

  it("pages cells with advancing cursors and rejects foreign cursors", async () => {
    const hashBytes = ["01", "02", "03", "04", "05"];
    const state = chainState();
    for (const byte of hashBytes) {
      state.cell(capacityCell(ccc.fixedPointFrom(100), aliceLock, byte));
    }
    const client = new FakeClient(state);

    const scan = await pageCells(client, lockKey(aliceLock), 2);
    expect(scan.pageSizes).toEqual([2, 2, 1]);
    expect(scan.cursors).toEqual(["2", "4"]);
    expect(scan.cells.map((cell) => cell.outPoint.txHash)).toEqual(
      hashBytes.map((byte) => byte32FromByte(byte)),
    );
    const descending = await pageCells(client, lockKey(aliceLock), 2, "desc");
    expect(descending.cells.map((cell) => cell.outPoint.txHash)).toEqual(
      hashBytes.map((byte) => byte32FromByte(byte)).toReversed(),
    );
    const wholePage = await client.findCellsPaged(lockKey(aliceLock));
    expect(wholePage.cells).toHaveLength(5);
    await expect(
      client.findCellsPaged(lockKey(aliceLock), undefined, 2, "stub:1"),
    ).rejects.toThrow('findCellsPagedNoCache received unknown cursor "stub:1"');
    await expect(
      client.findCellsPaged(lockKey(aliceLock), undefined, 2, "9".repeat(20)),
    ).rejects.toThrow("received unknown cursor");
  });
});

describe("FakeClient chain lookups", () => {
  it("serves tip and header lookups from chain state", async () => {
    const tip = headerLike({ number: 5n, hash: byte32FromByte("05") });
    const older = headerLike({ number: 3n, hash: byte32FromByte("03") });
    const client = new FakeClient(chainState().tip(tip).header(older));

    await expect(client.getTip()).resolves.toBe(5n);
    const tipHeader = await client.getTipHeader();
    expect(tipHeader.hash).toBe(tip.hash);
    const byNumber = await client.getHeaderByNumber(3n);
    expect(byNumber?.hash).toBe(older.hash);
    const byHash = await client.getHeaderByHash(older.hash);
    expect(byHash?.number).toBe(3n);
    await expect(client.getHeaderByNumber(9n)).resolves.toBeUndefined();
    await expect(client.getHeaderByHash(byte32FromByte("99"))).resolves.toBeUndefined();
  });

  it("serves transaction lookups with committed headers", async () => {
    const origin = ccc.Transaction.from({
      outputs: [{ capacity: ccc.fixedPointFrom(500), lock: aliceLock }],
    });
    const bare = ccc.Transaction.from({
      outputs: [{ capacity: ccc.fixedPointFrom(600), lock: bobLock }],
    });
    const block = headerLike({ number: 11n, hash: byte32FromByte("11") });
    const client = new FakeClient(
      chainState().committedTx(origin, block).committedTx(bare),
    );

    const response = await client.getTransaction(origin.hash());
    expect(response?.status).toBe("committed");
    expect(response?.blockNumber).toBe(11n);
    const withHeader = await client.getTransactionWithHeader(origin.hash());
    expect(withHeader?.transaction.blockHash).toBe(block.hash);
    expect(withHeader?.header?.hash).toBe(block.hash);
    const bareResponse = await client.getTransaction(bare.hash());
    expect(bareResponse?.blockHash).toBeUndefined();
    const originOutput = await client.getCell({ txHash: origin.hash(), index: 0 });
    // CCC 1.18 raises sub-occupancy capacities at construction (#459), so the
    // fixture must use an on-chain-legal capacity to round-trip unchanged.
    expect(originOutput?.cellOutput.capacity).toBe(ccc.fixedPointFrom(500));
    await expect(client.getCell(outPoint("99"))).resolves.toBeUndefined();
    await expect(client.getTransaction(byte32FromByte("99"))).resolves.toBeUndefined();
  });
});

describe("FakeClient sends", () => {
  it("applies committed sends to the live cell set", async () => {
    const input = capacityCell(ccc.fixedPointFrom(100), aliceLock, "07");
    // The real sendTransaction fee path probes inputs for NervosDao profit.
    const client = new FakeClient(
      chainState()
        .cell(input)
        .knownScript(ccc.KnownScript.NervosDao, {
          codeHash: byte32FromByte("da"),
          hashType: "type",
          cellDeps: [],
        }),
    );
    const tx = spendTx(input, 1000n, bobLock, ["0xabcd", "0x00"]);

    const txHash = await client.sendTransaction(tx);
    expect(txHash).toBe(tx.hash());
    await expect(client.getCellLive(input.outPoint, true)).resolves.toBeUndefined();
    const change = await client.getCellLive({ txHash, index: 0 }, true);
    expect(change?.cellOutput.capacity).toBe(input.cellOutput.capacity - 1000n);
    expect(change?.outputData).toBe("0xabcd");
    // Extra outputs data beyond the outputs never becomes a cell.
    await expect(client.getCellLive({ txHash, index: 1 }, true)).resolves.toBeUndefined();
    const spent = await client.getCell(input.outPoint);
    expect(spent?.cellOutput.lock.eq(aliceLock)).toBe(true);
    const response = await client.getTransaction(txHash);
    expect(response?.status).toBe("committed");
  });

  it("records scripted send statuses without spending inputs", async () => {
    const input = capacityCell(ccc.fixedPointFrom(100), aliceLock, "08");
    const client = new FakeClient(chainState().cell(input).sendStatus("pending"));
    const tx = spendTx(input, 1000n, bobLock);

    const txHash = await client.sendTransactionNoCache(tx);
    expect(txHash).toBe(tx.hash());
    const response = await client.getTransaction(txHash);
    expect(response?.status).toBe("pending");
    const stillLive = await client.getCellLive(input.outPoint, true);
    expect(stillLive?.outPoint.eq(input.outPoint)).toBe(true);
    await expect(client.getCellLive({ txHash, index: 0 }, true)).resolves.toBeUndefined();
  });
});

describe("FakeClient scripting and identity", () => {
  it("injects override handlers over chain state", async () => {
    const client = new FakeClient(chainState(), {
      getFeeRateStatistics: async (): Promise<{ mean: ccc.Num; median: ccc.Num }> => {
        await Promise.resolve();
        throw new Error("fee statistics unavailable");
      },
      getTip: async (): Promise<ccc.Num> => {
        await Promise.resolve();
        return 42n;
      },
    });
    await expect(client.getFeeRate()).rejects.toThrow("fee statistics unavailable");
    await expect(client.getTip()).resolves.toBe(42n);
  });

  it("scripts fee statistics, cycles, and dry runs", async () => {
    const state = chainState().feeRate(9000n).cycles(999n);
    expect(state.getFeeRateStatistics()).toEqual({ mean: 9000n, median: 9000n });
    const client = new FakeClient(state.feeRate(5000n, 3000n));
    await expect(client.getFeeRateStatistics()).resolves.toEqual({
      mean: 5000n,
      median: 3000n,
    });
    await expect(client.getFeeRate()).resolves.toBe(3000n);
    const tx = ccc.Transaction.default();
    await expect(client.estimateCycles(tx)).resolves.toBe(999n);
    await expect(client.sendTransactionDry(tx)).resolves.toBe(999n);
  });

  it("reports fake identity without any network meaning", () => {
    const client = new FakeClient(chainState());
    expect(client.url).toBe("fake://chain-state");
    expect(client.addressPrefix).toBe("ckt");
    const overridden = new FakeClient(chainState(), {
      addressPrefix: "ckb",
      url: "fake://other",
    });
    expect(overridden.addressPrefix).toBe("ckb");
    expect(overridden.url).toBe("fake://other");
  });

  it("blanks output data when live cells are fetched without data", async () => {
    const typed = stateCell("09", aliceLock, udtType, "0x1234");
    const client = new FakeClient(chainState().cell(typed));
    const withData = await client.getCellLive(typed.outPoint, true);
    expect(withData?.outputData).toBe("0x1234");
    const defaulted = await client.getCellLive(typed.outPoint);
    expect(defaulted?.outputData).toBe("0x1234");
    const withoutData = await client.getCellLive(typed.outPoint, false);
    expect(withoutData?.outputData).toBe("0x");
  });

  it("resolves known scripts registered on chain state", async () => {
    const client = new FakeClient(
      chainState().knownScript(ccc.KnownScript.NervosDao, {
        codeHash: byte32FromByte("dd"),
        hashType: "type",
        cellDeps: [],
      }),
    );
    const info = await client.getKnownScript(ccc.KnownScript.NervosDao);
    expect(info.codeHash).toBe(byte32FromByte("dd"));
  });
});

describe("FakeClient unscripted and hash-lookup overrides", () => {
  it("throws unscripted for block-by-hash and delegates its header override", async () => {
    const bare = new FakeClient(chainState());
    await expect(bare.getBlockByHashNoCache(byte32FromByte("77"))).rejects.toThrow(
      "getBlockByHashNoCache is not scripted",
    );
    const header = ccc.ClientBlockHeader.from(
      headerLike({ number: 31n, hash: byte32FromByte("31") }),
    );
    const block = ccc.ClientBlock.from({
      header,
      proposals: [],
      transactions: [],
      uncles: [],
    });
    const client = new FakeClient(chainState(), {
      getBlockByHashNoCache: scripted(block),
      getHeaderByHashNoCache: scripted(header),
    });
    const servedBlock = await client.getBlockByHashNoCache(byte32FromByte("31"));
    expect(servedBlock?.header.number).toBe(31n);
    const served = await client.getHeaderByHashNoCache(byte32FromByte("31"));
    expect(served?.number).toBe(31n);
  });
});

describe("FakeClient override dispatch", () => {
  it("dispatches every remaining member override", async () => {
    const header = headerLike({ number: 21n, hash: byte32FromByte("21") });
    const block = ccc.ClientBlock.from({
      header,
      proposals: [],
      transactions: [],
      uncles: [],
    });
    const cell = capacityCell(ccc.fixedPointFrom(1), aliceLock, "22");
    const page = { cells: [cell], lastCursor: "1" };
    const found = { lastCursor: "end", transactions: [] };
    const info = ccc.ScriptInfo.from({
      codeHash: byte32FromByte("44"),
      hashType: "type",
      cellDeps: [],
    });
    const response = ccc.ClientTransactionResponse.from({
      transaction: ccc.Transaction.default(),
      status: "proposed",
    });
    const client = new FakeClient(chainState(), {
      estimateCycles: scripted(1n),
      findCellsPagedNoCache: scripted(page),
      findTransactionsPaged: scripted(found),
      getBlockByHashNoCache: scripted(block),
      getBlockByNumberNoCache: scripted(block),
      getCellLiveNoCache: scripted(cell),
      getCellsCapacity: scripted(77n),
      getHeaderByHashNoCache: scripted(header),
      getHeaderByNumberNoCache: scripted(header),
      getKnownScript: scripted(info),
      getTipHeader: scripted(header),
      getTransactionNoCache: scripted(response),
      sendTransactionDry: scripted(2n),
      sendTransactionNoCache: scripted(byte32FromByte("33")),
    });
    const tx = ccc.Transaction.default();
    await expect(client.getKnownScript(ccc.KnownScript.XUdt)).resolves.toEqual(info);
    await expect(client.getTipHeader()).resolves.toEqual(header);
    await expect(client.getBlockByNumber(0n)).resolves.toEqual(block);
    await expect(client.getBlockByHash(header.hash)).resolves.toEqual(block);
    await expect(client.getHeaderByNumber(0n)).resolves.toEqual(header);
    await expect(client.getHeaderByHash(header.hash)).resolves.toEqual(header);
    await expect(client.estimateCycles(tx)).resolves.toBe(1n);
    await expect(client.sendTransactionDry(tx)).resolves.toBe(2n);
    await expect(client.sendTransactionNoCache(tx)).resolves.toBe(byte32FromByte("33"));
    await expect(client.getTransaction(response.transaction.hash())).resolves.toEqual(
      response,
    );
    await expect(client.getCellLive(cell.outPoint)).resolves.toEqual(cell);
    await expect(client.findCellsPaged(lockKey(aliceLock))).resolves.toEqual(page);
    await expect(client.findTransactionsPaged(lockKey(aliceLock))).resolves.toEqual(
      found,
    );
    await expect(client.getCellsCapacity(lockKey(aliceLock))).resolves.toBe(77n);
  });
});

describe("ChainState filters", () => {
  it("applies data, capacity, and mode filters", () => {
    const typed = stateCell("31", aliceLock, udtType, "0x1234");
    const state = chainState().cell(typed);
    const base = lockKey(aliceLock);
    const matched = (filter: ccc.ClientIndexerSearchKeyLike["filter"]): number =>
      state.matchLiveCells({ ...base, filter }, "asc").length;

    expect(matched({ outputData: "0x12" })).toBe(1);
    expect(matched({ outputData: "0xff" })).toBe(0);
    expect(matched({ outputData: "0x1234", outputDataSearchMode: "exact" })).toBe(1);
    expect(matched({ outputData: "0x12", outputDataSearchMode: "exact" })).toBe(0);
    expect(matched({ outputDataLenRange: [2n, 3n] })).toBe(1);
    expect(matched({ outputDataLenRange: [0n, 2n] })).toBe(0);
    expect(matched({ outputCapacityRange: [0n, ccc.fixedPointFrom(1000)] })).toBe(1);
    expect(matched({ outputCapacityRange: [0n, 1n] })).toBe(0);
    expect(
      matched({
        outputCapacityRange: [ccc.fixedPointFrom(1000), ccc.fixedPointFrom(2000)],
      }),
    ).toBe(0);
    expect(() => matched({ blockRange: [0n, 10n] })).toThrow(
      "blockRange filters are unsupported",
    );
    expect(() =>
      state.matchLiveCells({ ...base, scriptSearchMode: "partial" }, "asc"),
    ).toThrow("partial search mode");
  });
});
