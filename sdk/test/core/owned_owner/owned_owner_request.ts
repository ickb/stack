import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerCell, WithdrawalGroup } from "../../../src/core/cells.ts";
import type { DaoWithdrawalRequestCell } from "../../../src/core/dao_cells.ts";
import { OwnerData } from "../../../src/core/entities.ts";
import {
  DAO_OUTPUT_LIMIT,
  DaoManager,
  DaoOutputLimitError,
} from "../../../src/core/index.ts";
import { OwnedOwnerManager } from "../../../src/core/owned_owner.ts";
import {
  byte32FromByte,
  clientForDepositHeader,
  depositCell,
  headerLike,
  REQUEST_WITHDRAWAL_SUITE,
  requestWithdrawalFixture,
  script,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(REQUEST_WITHDRAWAL_SUITE, () => {
  registerOwnerDistanceTests();
  registerWithdrawalDepositValidationTests();
  registerWithdrawalInputTests();
  registerMalformedDaoManagerTests();
  registerWithdrawalRequestSelectionTests();
  registerOutputBoundaryTests();
});

function registerOwnerDistanceTests(): void {
  it("encodes owner distances from the actual withdrawal output indexes", () => {
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const ownerLock = script("44");
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const depositHeader = headerLike({ number: 1n });
    const deposits = [
      depositCell("55", ownedOwnerScript, daoScript, depositHeader),
      depositCell("66", ownedOwnerScript, daoScript, depositHeader),
    ];
    const baseTx = ccc.Transaction.default();
    baseTx.addInput({ previousOutput: { txHash: byte32FromByte("77"), index: 0n } });
    baseTx.addOutput({ capacity: 1n, lock: ownerLock }, "0x");

    const tx = manager.requestWithdrawal(baseTx, deposits, ownerLock);

    expect(tx.outputsData.slice(3)).toEqual([
      ccc.hexFrom(OwnerData.encode({ ownedDistance: -2n })),
      ccc.hexFrom(OwnerData.encode({ ownedDistance: -2n })),
    ]);
    const [, , , ownerAOutput, ownerBOutput] = tx.outputs;
    const [, , , ownerAData, ownerBData] = tx.outputsData;
    if (
      ownerAOutput === undefined ||
      ownerAData === undefined ||
      ownerBOutput === undefined ||
      ownerBData === undefined
    ) {
      throw new Error("Expected owner outputs");
    }
    const ownerA = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("99"), index: 3n },
        cellOutput: ownerAOutput,
        outputData: ownerAData,
      }),
    );
    const ownerB = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("99"), index: 4n },
        cellOutput: ownerBOutput,
        outputData: ownerBData,
      }),
    );
    expect(ownerA.getOwned().index).toBe(1n);
    expect(ownerB.getOwned().index).toBe(2n);
  });
}

function registerWithdrawalDepositValidationTests(): void {
  it("leaves transactions unchanged when no deposits or withdrawal groups are given", () => {
    const { manager, ownerLock } = requestWithdrawalFixture();
    const baseTx = ccc.Transaction.default();

    expect(manager.requestWithdrawal(baseTx, [], ownerLock)).toEqual(baseTx);
    expect(manager.withdraw(baseTx, [])).toEqual(baseTx);
  });
}

function registerWithdrawalInputTests(): void {
  registerSelectedWithdrawalInputTest();
  registerTypelessOwnerInputTest();
  registerMismatchedOwnerInputTest();
}

function registerSelectedWithdrawalInputTest(): void {
  it("adds selected owned withdrawals and owner marker inputs", async () => {
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const ownerLock = script("44");
    const depositHeader = headerLike({ number: 1n });
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new FastWithdrawDaoManager(daoScript, []),
    );
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("aa"), index: 1n },
        cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
        outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
      }),
    );
    const ownedCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("aa"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    const owned = await manager.daoManager.withdrawalRequestCellFrom(
      ownedCell,
      clientForDepositHeader(depositHeader),
      { tip: depositHeader },
    );

    const tx = manager.withdraw(ccc.Transaction.default(), [
      new WithdrawalGroup(owned, owner),
    ]);

    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toContain(
      owner.cell.outPoint.toHex(),
    );
  });
}

function registerTypelessOwnerInputTest(): void {
  it("adds owner marker inputs that have no type script", async () => {
    const { manager, ownerLock, depositHeader } = requestWithdrawalFixture();
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("ab"), index: 1n },
        cellOutput: { capacity: 61n, lock: ownerLock },
        outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
      }),
    );
    const owned = await manager.daoManager.withdrawalRequestCellFrom(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("ab"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: manager.script,
          type: manager.daoManager.script,
        },
        outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
      }),
      clientForDepositHeader(depositHeader),
      { tip: depositHeader },
    );

    const tx = manager.withdraw(ccc.Transaction.default(), [
      new WithdrawalGroup(owned, owner),
    ]);

    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toContain(
      owner.cell.outPoint.toHex(),
    );
  });
}

function registerMismatchedOwnerInputTest(): void {
  it("rejects withdrawal groups whose owner points at a different owned cell", async () => {
    const { manager, ownerLock, depositHeader } = requestWithdrawalFixture();
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("ac"), index: 2n },
        cellOutput: { capacity: 61n, lock: ownerLock, type: manager.script },
        outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
      }),
    );
    const owned = await manager.daoManager.withdrawalRequestCellFrom(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("ac"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: manager.script,
          type: manager.daoManager.script,
        },
        outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
      }),
      clientForDepositHeader(depositHeader),
      { tip: depositHeader },
    );

    expect(() =>
      manager.withdraw(ccc.Transaction.default(), [new WithdrawalGroup(owned, owner)]),
    ).toThrow(
      `Withdrawal owner ${owner.cell.outPoint.toHex()} points to ${owner.getOwned().toHex()} but group owned cell is ${owned.cell.outPoint.toHex()}`,
    );
  });
}

function registerMalformedDaoManagerTests(): void {
  it("rejects DAO withdrawal managers that do not add request outputs", () => {
    const ownerLock = script("44");
    const depositHeader = headerLike({ number: 1n });
    const requestedDeposit = depositCell("55", script("22"), script("33"), depositHeader);
    const manager = new OwnedOwnerManager(
      script("22"),
      [],
      new NoRequestOutputDaoManager(script("33")),
    );

    expect(() =>
      manager.requestWithdrawal(ccc.Transaction.default(), [requestedDeposit], ownerLock),
    ).toThrow("DAO withdrawal request did not add expected outputs");
  });

  it("rejects DAO withdrawal managers that add malformed request outputs", () => {
    const ownerLock = script("44");
    const depositHeader = headerLike({ number: 1n });
    const ownerScript = script("22");
    const daoScript = script("33");
    const requestedDeposit = depositCell("55", ownerScript, daoScript, depositHeader);
    const manager = new OwnedOwnerManager(
      ownerScript,
      [],
      new MalformedRequestOutputDaoManager(daoScript),
    );

    expect(() =>
      manager.requestWithdrawal(ccc.Transaction.default(), [requestedDeposit], ownerLock),
    ).toThrow("DAO withdrawal request output order changed");
  });
}

function registerWithdrawalRequestSelectionTests(): void {
  it("rejects duplicated or already spent withdrawal deposits", () => {
    const { manager, ownerLock, requestedDeposit } = requestWithdrawalFixture();
    const spentTx = ccc.Transaction.default();
    spentTx.addInput(requestedDeposit.cell);

    expect(() =>
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit, requestedDeposit],
        ownerLock,
      ),
    ).toThrow("Withdrawal deposit is duplicated");
    expect(() =>
      manager.requestWithdrawal(spentTx, [requestedDeposit], ownerLock),
    ).toThrow("Withdrawal deposit is already being spent");
  });
}

function registerOutputBoundaryTests(): void {
  it("rejects output 65 after appending withdrawal owner markers", () => {
    const { manager, ownerLock, requestedDeposit } = requestWithdrawalFixture();
    const tx = ccc.Transaction.default();
    for (let index = 1; index < DAO_OUTPUT_LIMIT; index += 1) {
      tx.addInput(
        ccc.Cell.from({
          outPoint: { txHash: byte32FromByte("dd"), index: BigInt(index) },
          cellOutput: { capacity: 1n, lock: ownerLock },
          outputData: "0x",
        }),
      );
      tx.addOutput({ capacity: 1n, lock: ownerLock }, "0x");
    }

    expect(() => manager.requestWithdrawal(tx, [requestedDeposit], ownerLock)).toThrow(
      DaoOutputLimitError,
    );
  });
}

class NoRequestOutputDaoManager extends DaoManager {
  constructor(daoScript: ccc.Script) {
    super(daoScript, []);
  }

  public override requestWithdrawal(txLike: ccc.TransactionLike): ccc.Transaction {
    return ccc.Transaction.from(txLike);
  }
}

class MalformedRequestOutputDaoManager extends DaoManager {
  constructor(daoScript: ccc.Script) {
    super(daoScript, []);
  }

  public override requestWithdrawal(txLike: ccc.TransactionLike): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    tx.addOutput({ capacity: 1n, lock: script("99"), type: this.script }, "0x");
    return tx;
  }
}

class FastWithdrawDaoManager extends DaoManager {
  public override withdraw(
    txLike: ccc.TransactionLike | ccc.Transaction,
    withdrawalRequests: DaoWithdrawalRequestCell[],
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    for (const withdrawalRequest of withdrawalRequests) {
      tx.addInput(withdrawalRequest.cell);
    }
    return tx;
  }
}
