import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";
import {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  type StubCell,
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
    header,
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

  it("refuses a non-positive deposit quantity", () => {
    for (const quantity of [0, -1]) {
      expect(() =>
        manager().deposit(
          ccc.Transaction.default(),
          quantity,
          ccc.fixedPointFrom(100082),
          script("44"),
        ),
      ).toThrow("iCKB deposit quantity must be a positive safe integer");
    }
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
    ).toThrow("iCKB deposit quantity must be a positive safe integer");
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

  it("rejects a receipt for another logic script", () => {
    const header = headerLike({ hash: byte32FromByte("44") });
    const wrongType = receiptFor("66", header, script("77"));

    expect(() =>
      manager().completeDeposit(ccc.Transaction.default(), [wrongType]),
    ).toThrow(
      `Receipt ${wrongType.cell.outPoint.toHex()} is not an iCKB receipt for this logic script`,
    );
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
      getHeaderByNumber: async (): Promise<ccc.ClientBlockHeader> => {
        await Promise.resolve();
        return header;
      },
    });

    const receipts = await manager().receiptsFrom(client, [
      { cell: other, blockNumber: 1n },
      { cell: receipt, blockNumber: 1n },
    ]);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: ccc.fixedPointFrom(200000),
      header,
    });
  });

  it("reads each block header once, concurrently, and keeps batch order", async () => {
    const first = receiptCellOf("11", receiptData(1n));
    const second = receiptCellOf("22", receiptData(1n));
    const twin = receiptCellOf("33", receiptData(1n));
    const requests: ccc.Num[] = [];
    const { promise: firstFetch, resolve: resolveFirst } =
      Promise.withResolvers<ccc.ClientBlockHeader>();
    const { promise: secondFetch, resolve: resolveSecond } =
      Promise.withResolvers<ccc.ClientBlockHeader>();
    const client = new StubClient({
      getHeaderByNumber: async (number): Promise<ccc.ClientBlockHeader> => {
        const asked = ccc.numFrom(number);
        requests.push(asked);
        return asked === 1n ? firstFetch : secondFetch;
      },
    });

    const receiptsPromise = manager().receiptsFrom(client, [
      { cell: first, blockNumber: 1n },
      { cell: second, blockNumber: 2n },
      { cell: twin, blockNumber: 1n },
    ]);
    await vi.waitFor(() => {
      expect(requests).toEqual([1n, 2n]);
    });
    resolveSecond(header);
    await Promise.resolve();
    resolveFirst(header);

    const receipts = await receiptsPromise;

    expect(receipts.map((receipt) => receipt.cell.outPoint.toHex())).toEqual(
      [first, second, twin].map((cell) => cell.outPoint.toHex()),
    );
  });

  it("rejects a malformed receipt payload with out point context", () => {
    const cell = receiptCellOf("11", "0x12");

    expect(() => receiptCell(cell, header)).toThrow(
      `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("rejects a missing block header", async () => {
    const receipt = receiptCellOf("11", receiptData(1n));
    const client = new StubClient({
      getHeaderByNumber: async (): Promise<undefined> => {
        await Promise.resolve();
        return undefined;
      },
    });

    await expect(
      manager().receiptsFrom(client, [{ cell: receipt, blockNumber: 7n }]),
    ).rejects.toThrow("Header not found for block number 7");
  });
});

describe("LogicManager.findDeposits", () => {
  const tip = headerLike({ epoch: [170n, 0n, 1n], number: 3n });
  const depositHeader = headerLike({
    epoch: [1n, 0n, 1n],
    number: 1n,
    dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
  });

  it("scans the logic lock for DAO deposits and values them at their deposit header", async () => {
    const deposit = depositCellOf("44");
    const wrongLock = depositCellOf("55", script("77"));
    const queries: cccA.JsonRpcIndexerSearchKey[] = [];
    const client = new StubClient({
      cells: (query): readonly StubCell[] => {
        queries.push(query);
        return [deposit, wrongLock].map((cell) => ({ cell, blockNumber: 1n }));
      },
      getHeaderByNumber: async (number): Promise<ccc.ClientBlockHeader | undefined> => {
        await Promise.resolve();
        return ccc.numFrom(number) === 1n ? depositHeader : undefined;
      },
    });

    const deposits = await manager().findDeposits(client, tip);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.script).toEqual(cccA.JsonRpcTransformers.scriptFrom(logic));
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({
      cell: deposit,
      header: depositHeader,
      udtValue: ickbValue(deposit.capacityFree, depositHeader),
    });
    expect(deposits[0]?.ckbValue).toBe(
      deposit.cellOutput.capacity +
        ccc.calcDaoProfit(deposit.capacityFree, depositHeader, tip),
    );
    expect(deposits[0]?.claimEpoch.eq(ccc.calcDaoClaimEpoch(depositHeader, tip))).toBe(
      true,
    );
  });

  it("reads one header per deposit block", async () => {
    const first = depositCellOf("44", logic, 0n);
    const second = depositCellOf("45", logic, 0n);
    let headerCalls = 0;
    const client = new StubClient({
      cells: (): readonly StubCell[] => [first, second],
      getHeaderByNumber: async (): Promise<ccc.ClientBlockHeader> => {
        headerCalls += 1;
        await Promise.resolve();
        return depositHeader;
      },
    });

    const deposits = await manager().findDeposits(client, tip);

    expect(headerCalls).toBe(1);
    expect(deposits.map((deposit) => deposit.cell.outPoint.txHash)).toEqual([
      first.outPoint.txHash,
      second.outPoint.txHash,
    ]);
  });
});
