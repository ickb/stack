import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiptData } from "../../../src/core/entities.ts";
import { LogicManager } from "../../../src/core/logic.ts";
import { DaoManager } from "../../../src/dao/index.ts";
import {
  byte32FromByte,
  headerLike,
  LOGIC_MANAGER_DEPOSIT_SUITE,
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
  registerReceiptWireFormatTests();
  registerReceiptConcurrencyTests();
  registerReceiptHeaderCacheTests();
});

function registerReceiptWireFormatTests(): void {
  it("matches the deployed receipt data wire format", () => {
    const encoded = ReceiptData.from({
      depositQuantity: 0x0102_0304,
      depositAmount: 0x0102_0304_0506_0708n,
    }).toBytes();

    expect(encoded).toHaveLength(12);
    expect(ccc.hexFrom(encoded)).toBe("0x040302010807060504030201");

    const decoded = ReceiptData.decodePrefix("0x040302010807060504030201aabbcc");
    expect(decoded.depositQuantity).toBe(0x0102_0304n);
    expect(decoded.depositAmount).toBe(0x0102_0304_0506_0708n);
  });
}

function registerReceiptFilteringTests(): void {
  it("converts only the receipt cells of a batch", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const receiptData = ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes();
    const validReceipt = receiptCell("44", logic, wantedLock, receiptData);
    const wrongType = receiptCell("66", script("77"), wantedLock, receiptData);
    const shortData = receiptCell("99", logic, wantedLock, "0x00");
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));
    const client = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike({ number: 1n, epoch: [1n, 0n, 1n] }));
      },
    });

    const receipts = await manager.receiptsFrom(client, [
      validReceipt,
      wrongType,
      shortData,
    ]);

    expect(manager.isReceipt(shortData)).toBe(false);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.cell.outPoint.txHash).toBe(byte32FromByte("44"));
  });
}

function registerReceiptConcurrencyTests(): void {
  it("fetches receipt headers concurrently and keeps batch order", async () => {
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
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === firstReceipt.outPoint.txHash ? firstFetch : secondFetch;
      },
    });

    const receiptsPromise = manager.receiptsFrom(client, [firstReceipt, secondReceipt]);

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

function registerReceiptHeaderCacheTests(): void {
  it("reuses one transaction header request across the receipts of a batch", async () => {
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
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(headerLike());
      },
    });

    const receipts = await manager.receiptsFrom(client, [firstReceipt, secondReceipt]);

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
