import { ccc } from "@ckb-ccc/core";
import { DaoManager, type DaoDepositCell } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptCell } from "../../src/cells.ts";
import { ReceiptData } from "../../src/entities.ts";
import { LogicManager } from "../../src/logic.ts";
import { IckbUdt } from "../../src/udt.ts";
import {
  byte32FromByte,
  headerLike,
  LOGIC_MANAGER_DEPOSIT_SUITE,
  receiptPhase2Capacity,
  script,
  StubClient,
  testClient,
} from "./support/logic_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(LOGIC_MANAGER_DEPOSIT_SUITE, () => {
  registerDepositEncodingTests();
  registerReceiptSizingTests();
  registerDepositRecognitionTests();
  registerDepositCompletionTests();
  registerDepositFindingTests();
});

function registerDepositEncodingTests(): void {
  it("encodes receipt amounts from deposit free capacity", async () => {
    const logic = script("11");
    const dao = script("22");
    const user = script("33");
    const manager = new LogicManager(logic, [], new DaoManager(dao, []));

    const tx = await manager.deposit(
      ccc.Transaction.default(),
      2,
      ccc.fixedPointFrom(100082),
      user,
      testClient(),
    );

    expect(tx.outputs).toHaveLength(3);
    expect(tx.outputs[0]?.capacity).toBe(ccc.fixedPointFrom(100082));
    expect(tx.outputs[1]?.capacity).toBe(ccc.fixedPointFrom(100082));
    const receiptData = tx.outputsData[2];
    const receiptOutput = tx.outputs[2];
    if (receiptData === undefined || receiptOutput === undefined) {
      throw new Error("Expected receipt output");
    }
    const receipt = ReceiptData.decode(receiptData);
    expect(receipt.depositQuantity).toBe(2n);
    expect(receipt.depositAmount).toBe(ccc.fixedPointFrom(100000));
    expect(receiptOutput.capacity).toBe(receiptPhase2Capacity(user));
  });

  it("leaves the transaction unchanged for non-positive deposit quantities", async () => {
    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: 1n, lock: script("33") }, "0x");

    await expect(
      manager.deposit(tx, 0, ccc.fixedPointFrom(100082), script("33"), testClient()),
    ).resolves.toEqual(tx);
  });
}

function registerReceiptSizingTests(): void {
  it("sizes receipt capacity from the actual user lock", async () => {
    const logic = script("11");
    const dao = script("22");
    const user = script("33", `0x${"44".repeat(20)}`);
    const manager = new LogicManager(logic, [], new DaoManager(dao, []));

    const tx = await manager.deposit(
      ccc.Transaction.default(),
      1,
      ccc.fixedPointFrom(100082),
      user,
      testClient(),
    );

    expect(tx.outputs[1]?.capacity).toBe(receiptPhase2Capacity(user));
  });

  it("sizes iCKB xUDT cells from the actual token script shape", () => {
    const lock = script("33", `0x${"44".repeat(20)}`);
    const logic = script("11");
    const xudtType = IckbUdt.typeScriptFrom(script("22"), logic);
    const xudtCell = ccc.CellAny.from({
      cellOutput: { lock, type: xudtType },
      outputData: `0x${"00".repeat(16)}`,
    });

    expect(IckbUdt.minimumXudtCellCapacity(lock)).toBe(
      BigInt(xudtCell.occupiedSize) * ccc.One,
    );
  });
}

function registerDepositRecognitionTests(): void {
  it("identifies DAO deposits locked by the logic script", () => {
    const logic = script("11");
    const dao = script("22");
    const manager = new LogicManager(logic, [], new DaoManager(dao, []));
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao },
      outputData: DaoManager.depositData(),
    });
    const wrongLock = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: script("33"), type: dao },
      outputData: DaoManager.depositData(),
    });

    expect(manager.isDeposit(deposit)).toBe(true);
    expect(manager.isDeposit(wrongLock)).toBe(false);
  });
}

function registerDepositCompletionTests(): void {
  it("adds receipt inputs and unique receipt header deps when completing deposits", () => {
    const logic = script("11");
    const manager = new LogicManager(
      logic,
      [
        ccc.CellDep.from({
          outPoint: { txHash: byte32FromByte("22"), index: 0n },
          depType: "code",
        }),
      ],
      new DaoManager(script("33"), []),
    );
    const firstHeader = headerLike({ hash: byte32FromByte("44") });
    const secondHeader = headerLike({ hash: byte32FromByte("55") });
    const receipts = [
      receiptForCompletion("66", firstHeader, logic),
      receiptForCompletion("77", firstHeader, logic),
      receiptForCompletion("88", secondHeader, logic),
    ];

    const tx = manager.completeDeposit(ccc.Transaction.default(), receipts);

    expect(tx.cellDeps).toHaveLength(1);
    expect(tx.headerDeps).toEqual([firstHeader.hash, secondHeader.hash]);
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual(
      receipts.map((receipt) => receipt.cell.outPoint.toHex()),
    );
    expect(manager.completeDeposit(tx, [])).toEqual(tx);
  });

  it("rejects structural receipts for another logic script or tx hash", () => {
    const logic = script("11");
    const manager = new LogicManager(logic, [], new DaoManager(script("33"), []));
    const header = headerLike({ hash: byte32FromByte("44") });
    const wrongType = receiptForCompletion("66", header, script("77"));
    const wrongTxHash = receiptForCompletion("88", header, logic);
    wrongTxHash.header = { ...wrongTxHash.header, txHash: byte32FromByte("99") };

    expect(() => manager.completeDeposit(ccc.Transaction.default(), [wrongType])).toThrow(
      `Receipt ${wrongType.cell.outPoint.toHex()} is not an iCKB receipt for this logic script`,
    );
    expect(() =>
      manager.completeDeposit(ccc.Transaction.default(), [wrongTxHash]),
    ).toThrow(
      `Receipt ${wrongTxHash.cell.outPoint.toHex()} header txHash ${String(wrongTxHash.header.txHash)} does not match cell txHash ${wrongTxHash.cell.outPoint.txHash}`,
    );
  });

  it("rejects duplicated or already-spent receipt inputs", () => {
    const logic = script("11");
    const manager = new LogicManager(logic, [], new DaoManager(script("33"), []));
    const receipt = receiptForCompletion("66", headerLike(), logic);
    const tx = ccc.Transaction.default();
    tx.addInput(receipt.cell);

    expect(() =>
      manager.completeDeposit(ccc.Transaction.default(), [receipt, receipt]),
    ).toThrow(`Receipt ${receipt.cell.outPoint.toHex()} is duplicated`);
    expect(() => manager.completeDeposit(tx, [receipt])).toThrow(
      `Receipt ${receipt.cell.outPoint.toHex()} is already being spent`,
    );
  });
}

function registerDepositFindingTests(): void {
  it("finds only DAO deposits locked by the logic script", async () => {
    const logic = script("11");
    const dao = script("22");
    const tip = headerLike({ hash: byte32FromByte("33"), number: 3n });
    const depositHeader = headerLike({ hash: byte32FromByte("44"), number: 1n });
    const goodDeposit = depositDaoCell("55", logic, dao, depositHeader);
    const wrongLockDeposit = depositDaoCell("66", script("77"), dao, depositHeader);
    let tipReads = 0;
    const fakeDaoManager = new FindDepositsDaoManager(dao, [
      goodDeposit,
      wrongLockDeposit,
    ]);
    const manager = new LogicManager(logic, [], fakeDaoManager);
    const client = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        tipReads += 1;
        await Promise.resolve();
        return tip;
      },
    });

    const deposits = await collect(manager.findDeposits(client));
    const explicitTipDeposits = await collect(manager.findDeposits(client, { tip }));

    expect(tipReads).toBe(1);
    expect(deposits).toHaveLength(1);
    expect(deposits[0]?.cell.outPoint.toHex()).toBe(goodDeposit.cell.outPoint.toHex());
    expect(explicitTipDeposits).toHaveLength(1);
    expect(tipReads).toBe(1);
  });
}

class FindDepositsDaoManager extends DaoManager {
  private readonly deposits: DaoDepositCell[];

  constructor(daoScript: ccc.Script, deposits: DaoDepositCell[]) {
    super(daoScript, []);
    this.deposits = deposits;
  }

  public override isDeposit(cell: ccc.CellAny): boolean {
    return cell.cellOutput.type?.eq(this.script) === true;
  }

  public override async *findDeposits(): AsyncGenerator<DaoDepositCell> {
    await Promise.resolve();
    yield* this.deposits;
  }
}

function receiptForCompletion(
  txHashByte: string,
  header: ccc.ClientBlockHeader,
  logic: ccc.Script,
): ReceiptCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: 61n, lock: script("99"), type: logic },
    outputData: ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes(),
  });
  return {
    cell,
    header: { header, txHash: cell.outPoint.txHash },
    ckbValue: cell.cellOutput.capacity,
    udtValue: 1n,
  };
}

function depositDaoCell(
  txHashByte: string,
  lock: ccc.Script,
  dao: ccc.Script,
  depositHeader: ccc.ClientBlockHeader,
): DaoDepositCell {
  const txHash = byte32FromByte(txHashByte);
  const cell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: dao },
    outputData: DaoManager.depositData(),
  });
  return {
    cell,
    headers: [{ header: depositHeader, txHash }, { header: depositHeader }],
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
    interests: 0n,
    maturity: depositHeader.epoch,
    isDeposit: true,
    isReady: true,
  };
}
