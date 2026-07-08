import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptData } from "../../src/entities.ts";
import { LogicManager } from "../../src/logic.ts";
import {
  byte32FromByte,
  headerLike,
  LOGIC_MANAGER_DEPOSIT_SUITE,
  noCellsOnChain,
  receiptPair,
  script,
  StubClient,
  transactionWithHeader,
} from "./support/logic_support.ts";

describe(LOGIC_MANAGER_DEPOSIT_SUITE, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  registerReceiptFilteringTests();
  registerReceiptConcurrencyTests();
  registerReceiptPageSizeTests();
  registerReceiptHeaderCacheTests();
});

function registerReceiptFilteringTests(): void {
  it("filters receipts by exact lock and type while deduplicating locks", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const otherLock = script("33");
    const receiptData = ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes();
    const validReceipt = receiptCell("44", logic, wantedLock, receiptData);
    const wrongLock = receiptCell("55", logic, otherLock, receiptData);
    const wrongType = receiptCell("66", script("77"), wantedLock, receiptData);
    const shortData = receiptCell("99", logic, wantedLock, "0x00");
    let calls = 0;
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        calls += 1;
        yield validReceipt;
        yield wrongLock;
        yield wrongType;
        yield shortData;
      },
      findCellsOnChain: noCellsOnChain,
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike({ number: 1n, epoch: [1n, 0n, 1n] }));
      },
    });

    const receipts = await collect(
      manager.findReceipts(client, [wantedLock, wantedLock]),
    );

    expect(calls).toBe(1);
    expect(manager.isReceipt(shortData)).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.cell.outPoint.txHash).toBe(byte32FromByte("44"));
  });
}

function registerReceiptConcurrencyTests(): void {
  it("fetches receipt headers concurrently and yields scan order", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const [firstReceipt, secondReceipt] = receiptPair(logic, wantedLock);
    const header = headerLike({ number: 1n, epoch: [1n, 0n, 1n] });
    const { promise: firstFetch, resolve: resolveFirst } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const { promise: secondFetch, resolve: resolveSecond } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const requests: ccc.Hex[] = [];
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield firstReceipt;
        yield secondReceipt;
      },
      findCellsOnChain: noCellsOnChain,
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === firstReceipt.outPoint.txHash ? firstFetch : secondFetch;
      },
    });

    const receiptsPromise = collect(manager.findReceipts(client, [wantedLock]));

    await vi.waitFor(() => {
      expect(requests).toEqual([
        firstReceipt.outPoint.txHash,
        secondReceipt.outPoint.txHash,
      ]);
    });
    resolveSecond(transactionWithHeader(header));
    await Promise.resolve();
    resolveFirst(transactionWithHeader(header));

    const receipts = await receiptsPromise;

    expect(receipts.map((receipt) => receipt.cell.outPoint.txHash)).toEqual([
      firstReceipt.outPoint.txHash,
      secondReceipt.outPoint.txHash,
    ]);
  });
}

function registerReceiptPageSizeTests(): void {
  it("passes the cell page size to receipt scanning", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const [firstReceipt, secondReceipt] = receiptPair(logic, wantedLock);
    let requestedPageSize = 0;
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      async *findCells(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCells"]> {
        requestedPageSize = pageSize;
        await Promise.resolve();
        yield firstReceipt;
        yield secondReceipt;
      },
      findCellsOnChain: noCellsOnChain,
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike());
      },
    });

    const receipts = await collect(
      manager.findReceipts(client, [wantedLock], { pageSize: 1 }),
    );

    expect(requestedPageSize).toBe(1);
    expect(receipts.map((receipt) => receipt.cell.outPoint.txHash)).toEqual([
      firstReceipt.outPoint.txHash,
      secondReceipt.outPoint.txHash,
    ]);
  });

  it("scans receipts directly from chain when requested", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const [receipt] = receiptPair(logic, wantedLock);
    let onChainPageSize = 0;
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      async *findCellsOnChain(
        _query,
        _order,
        pageSize = 10,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        onChainPageSize = pageSize;
        await Promise.resolve();
        yield receipt;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike());
      },
    });

    const receipts = await collect(
      manager.findReceipts(client, [wantedLock], { onChain: true, pageSize: 2 }),
    );

    expect(onChainPageSize).toBe(2);
    expect(receipts).toHaveLength(1);
  });
}

function registerReceiptHeaderCacheTests(): void {
  it("reuses receipt transaction header requests across lock scans", async () => {
    const logic = script("11");
    const firstLock = script("22");
    const secondLock = script("33");
    const txHash = byte32FromByte("44");
    const receiptData = ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes();
    const firstReceipt = receiptCellAt({
      txHash,
      index: 0n,
      logic,
      lock: firstLock,
      outputData: receiptData,
    });
    const secondReceipt = receiptCellAt({
      txHash,
      index: 1n,
      logic,
      lock: secondLock,
      outputData: receiptData,
    });
    let transactionCalls = 0;
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      async *findCells(query): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield ccc.Script.from(query.script).eq(firstLock) ? firstReceipt : secondReceipt;
      },
      findCellsOnChain: noCellsOnChain,
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike());
      },
    });

    const receipts = await collect(manager.findReceipts(client, [firstLock, secondLock]));

    expect(transactionCalls).toBe(1);
    expect(receipts.map((receipt) => receipt.cell.outPoint.index)).toEqual([0n, 1n]);
  });
}

function receiptCell(
  txHashByte: string,
  logic: ccc.Script,
  lock: ccc.Script,
  outputData: ccc.BytesLike,
): ccc.Cell {
  return receiptCellAt({
    txHash: byte32FromByte(txHashByte),
    index: 0n,
    logic,
    lock,
    outputData,
  });
}

function receiptCellAt(options: ReceiptCellAtOptions): ccc.Cell {
  const { txHash, index, logic, lock, outputData } = options;
  return ccc.Cell.from({
    outPoint: { txHash, index },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: logic },
    outputData,
  });
}

interface ReceiptCellAtOptions {
  txHash: ccc.Hex;
  index: bigint;
  logic: ccc.Script;
  lock: ccc.Script;
  outputData: ccc.BytesLike;
}
