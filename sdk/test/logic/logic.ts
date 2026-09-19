import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
} from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { DAO_OUTPUT_LIMIT, DaoOutputLimitError, depositData } from "../../src/dao.ts";
import {
  LogicManager,
  receiptCell,
  receiptPhase2Capacity,
  type ReceiptCell,
} from "../../src/logic.ts";
import {
  decodeReceiptData,
  encodeReceiptData,
  IckbUdt,
  ickbValue,
} from "../../src/udt.ts";

const logic = script("11");
const dao = { script: script("22"), cellDeps: [] };

function manager(cellDeps: ccc.CellDep[] = []): LogicManager {
  return new LogicManager(logic, cellDeps, dao);
}

function receiptCellOf(
  txHashByte: string,
  outputData: ccc.Hex,
  type = logic,
  lock = script("33"),
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type },
    outputData,
  });
}

function receiptData(
  depositQuantity: bigint,
  depositAmount = ccc.fixedPointFrom(100000),
): ccc.Hex {
  return ccc.hexFrom(encodeReceiptData({ depositQuantity, depositAmount }));
}

function depositCellOf(txHashByte: string, lock = logic, index = 0n): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: dao.script },
    outputData: depositData(),
  });
}

function receiptFor(
  txHashByte: string,
  header: ccc.ClientBlockHeader,
  type = logic,
): ReceiptCell {
  const cell = receiptCellOf(txHashByte, receiptData(1n), type);
  return {
    cell,
    header: { header, txHash: cell.outPoint.txHash },
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
  };
}

describe("receipt data", () => {
  it("matches the deployed receipt data wire format", () => {
    const encoded = encodeReceiptData({
      depositQuantity: 0x0102_0304n,
      depositAmount: 0x0102_0304_0506_0708n,
    });

    expect(encoded).toHaveLength(12);
    expect(ccc.hexFrom(encoded)).toBe("0x040302010807060504030201");

    const decoded = decodeReceiptData("0x040302010807060504030201aabbcc");
    expect(decoded.depositQuantity).toBe(0x0102_0304n);
    expect(decoded.depositAmount).toBe(0x0102_0304_0506_0708n);
  });
});

describe("LogicManager.deposit", () => {
  it("adds the deposits, their DAO deps, and a receipt sized for phase 2", () => {
    const lock = script("44", "0x1234");
    const dep = ccc.CellDep.from({
      outPoint: { txHash: byte32FromByte("aa"), index: 0n },
      depType: "code",
    });

    const tx = manager([dep]).deposit(
      ccc.Transaction.default(),
      2,
      ccc.fixedPointFrom(100082),
      lock,
    );

    expect(tx.cellDeps).toEqual([dep]);
    expect(tx.outputs).toHaveLength(3);
    expect(tx.outputs[0]?.type?.eq(dao.script)).toBe(true);
    expect(tx.outputs[0]?.lock.eq(logic)).toBe(true);
    expect(tx.outputsData.slice(0, 2)).toEqual([depositData(), depositData()]);
    expect(tx.outputs[2]?.capacity).toBe(receiptPhase2Capacity(lock));
    expect(tx.outputs[2]?.type?.eq(logic)).toBe(true);
    expect(decodeReceiptData(tx.outputsData[2] ?? "0x")).toEqual({
      depositQuantity: 2n,
      depositAmount: ccc.fixedPointFrom(100000),
    });
  });

  it("leaves the transaction unchanged for non-positive deposit quantities", () => {
    const tx = ccc.Transaction.default();

    expect(manager().deposit(tx, 0, ccc.fixedPointFrom(100082), script("44"))).toBe(tx);
  });

  it("sizes receipt capacity from the actual user lock", () => {
    const shortLock = script("44");
    const longLock = script("44", `0x${"ab".repeat(40)}`);
    const plainCellCapacity = (lock: ccc.Script): bigint =>
      BigInt(ccc.CellAny.from({ cellOutput: { lock }, outputData: "0x" }).occupiedSize) *
      ccc.One;

    expect(receiptPhase2Capacity(longLock)).toBeGreaterThan(
      receiptPhase2Capacity(shortLock),
    );
    expect(receiptPhase2Capacity(shortLock)).toBe(
      plainCellCapacity(shortLock) + IckbUdt.minimumXudtCellCapacity(shortLock) + ccc.One,
    );
  });

  it("keeps the protocol minimum and maximum on unoccupied capacity", () => {
    expect(() =>
      manager().deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1081),
        script("44"),
      ),
    ).toThrow("iCKB deposit minimum is 1000 CKB free capacity");
    expect(() =>
      manager().deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1000083),
        script("44"),
      ),
    ).toThrow("iCKB deposit maximum is 1000000 CKB free capacity");
  });

  it("rejects non-safe-integer deposit quantities before allocation", () => {
    expect(() =>
      manager().deposit(
        ccc.Transaction.default(),
        1.5,
        ccc.fixedPointFrom(100082),
        script("44"),
      ),
    ).toThrow("iCKB deposit quantity must be a safe integer");
  });

  it("rejects deposit quantities that cannot fit in one DAO transaction", () => {
    expect(() =>
      manager().deposit(
        ccc.Transaction.default(),
        64,
        ccc.fixedPointFrom(100082),
        script("44"),
      ),
    ).toThrow(DaoOutputLimitError);
  });

  it("rejects output 65 after appending the receipt", () => {
    const tx = ccc.Transaction.default();
    for (let index = 0; index < DAO_OUTPUT_LIMIT - 1; index += 1) {
      tx.addOutput({ capacity: 1n, lock: script("44") }, "0x");
    }

    expect(() =>
      manager().deposit(tx, 1, ccc.fixedPointFrom(100082), script("44")),
    ).toThrow(DaoOutputLimitError);
  });
});

describe("LogicManager cell shapes", () => {
  it("identifies receipts and DAO deposits locked by the logic script", () => {
    const target = manager();

    expect(target.isDeposit(depositCellOf("44"))).toBe(true);
    expect(target.isDeposit(depositCellOf("55", script("33")))).toBe(false);
    expect(target.isReceipt(receiptCellOf("66", receiptData(1n)))).toBe(true);
    expect(target.isReceipt(receiptCellOf("77", "0x1234"))).toBe(false);
    expect(target.isReceipt(receiptCellOf("88", receiptData(1n), script("99")))).toBe(
      false,
    );
  });
});

describe("LogicManager.completeDeposit", () => {
  it("adds receipt inputs and unique receipt header deps", () => {
    const dep = ccc.CellDep.from({
      outPoint: { txHash: byte32FromByte("22"), index: 0n },
      depType: "code",
    });
    const firstHeader = headerLike({ hash: byte32FromByte("44") });
    const secondHeader = headerLike({ hash: byte32FromByte("55") });
    const receipts = [
      receiptFor("66", firstHeader),
      receiptFor("77", firstHeader),
      receiptFor("88", secondHeader),
    ];

    const tx = manager([dep]).completeDeposit(ccc.Transaction.default(), receipts);

    expect(tx.cellDeps).toEqual([dep]);
    expect(tx.headerDeps).toEqual([firstHeader.hash, secondHeader.hash]);
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual(
      receipts.map((receipt) => receipt.cell.outPoint.toHex()),
    );
    expect(manager().completeDeposit(tx, [])).toEqual(tx);
  });

  it("rejects structural receipts for another logic script or tx hash", () => {
    const header = headerLike({ hash: byte32FromByte("44") });
    const wrongType = receiptFor("66", header, script("77"));
    const wrongTxHash = receiptFor("88", header);
    wrongTxHash.header = { ...wrongTxHash.header, txHash: byte32FromByte("99") };

    expect(() =>
      manager().completeDeposit(ccc.Transaction.default(), [wrongType]),
    ).toThrow(
      `Receipt ${wrongType.cell.outPoint.toHex()} is not an iCKB receipt for this logic script`,
    );
    expect(() =>
      manager().completeDeposit(ccc.Transaction.default(), [wrongTxHash]),
    ).toThrow("header txHash");
  });
});

describe("LogicManager.receiptsFrom", () => {
  const header = headerLike({ dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n } });

  it("values only the receipts of a batch, ignoring trailing payload bytes", async () => {
    const receipt = receiptCellOf(
      "11",
      ccc.hexFrom([
        ...encodeReceiptData({
          depositQuantity: 2n,
          depositAmount: ccc.fixedPointFrom(100000),
        }),
        0xab,
        0xcd,
      ]),
    );
    const other = depositCellOf("12");
    const client = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(header);
      },
    });

    const receipts = await manager().receiptsFrom(client, [other, receipt]);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: ccc.fixedPointFrom(200000),
      header: { header, txHash: receipt.outPoint.txHash },
    });
  });

  it("reads each transaction header once, concurrently, and keeps batch order", async () => {
    const first = receiptCellOf("11", receiptData(1n));
    const second = receiptCellOf("22", receiptData(1n));
    const twin = ccc.Cell.from({
      outPoint: { txHash: first.outPoint.txHash, index: 1n },
      cellOutput: first.cellOutput,
      outputData: first.outputData,
    });
    const requests: ccc.Hex[] = [];
    const { promise: firstFetch, resolve: resolveFirst } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const { promise: secondFetch, resolve: resolveSecond } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const client = new StubClient({
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        const hash = ccc.hexFrom(txHash);
        requests.push(hash);
        return hash === first.outPoint.txHash ? firstFetch : secondFetch;
      },
    });

    const receiptsPromise = manager().receiptsFrom(client, [first, second, twin]);
    await vi.waitFor(() => {
      expect(requests).toEqual([first.outPoint.txHash, second.outPoint.txHash]);
    });
    resolveSecond(transactionWithHeader(header));
    await Promise.resolve();
    resolveFirst(transactionWithHeader(header));

    const receipts = await receiptsPromise;

    expect(receipts.map((receipt) => receipt.cell.outPoint.toHex())).toEqual(
      [first, second, twin].map((cell) => cell.outPoint.toHex()),
    );
  });

  it("rejects a malformed receipt payload with out point context", () => {
    const cell = receiptCellOf("11", "0x12");

    expect(() => receiptCell(cell, { header, txHash: cell.outPoint.txHash })).toThrow(
      `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("rejects a missing transaction header", async () => {
    const receipt = receiptCellOf("11", receiptData(1n));
    const client = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return undefined;
      },
    });

    await expect(manager().receiptsFrom(client, [receipt])).rejects.toThrow(
      `Header not found for txHash ${receipt.outPoint.txHash}`,
    );
  });
});

describe("LogicManager.findDeposits", () => {
  const tip = headerLike({ epoch: [170n, 0n, 1n], number: 3n });
  const depositHeader = headerLike({
    epoch: [1n, 0n, 1n],
    number: 1n,
    dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
  });
  const window = {
    minLockUp: ccc.Epoch.from([0n, 1n, 24n]),
    maxLockUp: ccc.Epoch.from([18n, 0n, 1n]),
  };

  it("scans the logic lock for DAO deposits and values them at their deposit header", async () => {
    const deposit = depositCellOf("44");
    const wrongLock = depositCellOf("55", script("77"));
    const queries: ccc.ClientIndexerSearchKeyLike[] = [];
    const client = new StubClient({
      async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
        queries.push(query);
        await Promise.resolve();
        yield deposit;
        yield wrongLock;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(depositHeader);
      },
    });

    const deposits = await manager().findDeposits(client, tip, window);

    expect(queries).toHaveLength(1);
    expect(ccc.Script.from(queries[0]?.script ?? logic).eq(logic)).toBe(true);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({
      cell: deposit,
      headers: [
        { header: depositHeader, txHash: deposit.outPoint.txHash },
        { header: tip },
      ],
      interests: ccc.calcDaoProfit(deposit.capacityFree, depositHeader, tip),
      isReady: true,
      udtValue: ickbValue(deposit.capacityFree, depositHeader),
    });
    expect(deposits[0]?.ckbValue).toBe(
      deposit.cellOutput.capacity + (deposits[0]?.interests ?? 0n),
    );
    expect(deposits[0]?.maturity.eq(ccc.calcDaoClaimEpoch(depositHeader, tip))).toBe(
      true,
    );
  });

  it("reads one header per deposit transaction", async () => {
    const first = depositCellOf("44", logic, 0n);
    const second = depositCellOf("44", logic, 1n);
    let transactionCalls = 0;
    const client = new StubClient({
      async *findCellsOnChain(): ReturnType<ccc.Client["findCellsOnChain"]> {
        await Promise.resolve();
        yield first;
        yield second;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        transactionCalls += 1;
        await Promise.resolve();
        return transactionWithHeader(depositHeader);
      },
    });

    const deposits = await manager().findDeposits(client, tip, window);

    expect(transactionCalls).toBe(1);
    expect(deposits.map((deposit) => deposit.cell.outPoint.index)).toEqual([0n, 1n]);
  });
});
