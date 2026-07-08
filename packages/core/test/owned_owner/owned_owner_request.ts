import { ccc } from "@ckb-ccc/core";
import { DaoManager, type DaoWithdrawalRequestCell } from "@ickb/dao";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnerCell, WithdrawalGroup } from "../../src/cells.ts";
import { OwnerData } from "../../src/entities.ts";
import { OwnedOwnerManager } from "../../src/owned_owner.ts";
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
  registerLiveDepositAnchorTests();
  registerWithdrawalDepositValidationTests();
  registerWithdrawalInputTests();
  registerMalformedDaoManagerTests();
  registerWithdrawalRequestSelectionTests();
});

function registerOwnerDistanceTests(): void {
  it("encodes owner distances from the actual withdrawal output indexes", async () => {
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

    const tx = await manager.requestWithdrawal(
      baseTx,
      deposits,
      ownerLock,
      clientForDepositHeader(depositHeader),
    );

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

function registerLiveDepositAnchorTests(): void {
  it("adds required live deposit anchors as cell deps", async () => {
    const { manager, ownerLock, depositHeader, requestedDeposit, requiredLiveDeposit } =
      requestWithdrawalFixture();

    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [requestedDeposit],
      ownerLock,
      clientForDepositHeader(depositHeader),
      { requiredLiveDeposits: [requiredLiveDeposit] },
    );

    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({ outPoint: requiredLiveDeposit.cell.outPoint, depType: "code" }),
    );
  });
}

function registerWithdrawalDepositValidationTests(): void {
  it("leaves transactions unchanged when no withdrawal groups are selected", async () => {
    const { manager, depositHeader } = requestWithdrawalFixture();
    const baseTx = ccc.Transaction.default();
    const notReadyGroup = withdrawalGroupFixture({
      isReady: false,
      daoScript: manager.daoManager.script,
      ownedOwnerScript: manager.script,
      depositHeader,
    });

    await expect(
      manager.withdraw(baseTx, [notReadyGroup], clientForDepositHeader(depositHeader), {
        isReadyOnly: true,
      }),
    ).resolves.toEqual(baseTx);
    await expect(
      manager.withdraw(baseTx, [], clientForDepositHeader(depositHeader)),
    ).resolves.toEqual(baseTx);
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

    const tx = await manager.withdraw(
      ccc.Transaction.default(),
      [new WithdrawalGroup(owned, owner)],
      clientForDepositHeader(depositHeader),
    );

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

    const tx = await manager.withdraw(
      ccc.Transaction.default(),
      [new WithdrawalGroup(owned, owner)],
      clientForDepositHeader(depositHeader),
    );

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

    await expect(
      manager.withdraw(
        ccc.Transaction.default(),
        [new WithdrawalGroup(owned, owner)],
        clientForDepositHeader(depositHeader),
      ),
    ).rejects.toThrow(
      `Withdrawal owner ${owner.cell.outPoint.toHex()} points to ${owner.getOwned().toHex()} but group owned cell is ${owned.cell.outPoint.toHex()}`,
    );
  });
}

function registerMalformedDaoManagerTests(): void {
  it("rejects DAO withdrawal managers that do not add request outputs", async () => {
    const ownerLock = script("44");
    const depositHeader = headerLike({ number: 1n });
    const requestedDeposit = depositCell("55", script("22"), script("33"), depositHeader);
    const manager = new OwnedOwnerManager(
      script("22"),
      [],
      new NoRequestOutputDaoManager(script("33")),
    );

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
      ),
    ).rejects.toThrow("DAO withdrawal request did not add expected outputs");
  });

  it("rejects DAO withdrawal managers that add malformed request outputs", async () => {
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

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
      ),
    ).rejects.toThrow("DAO withdrawal request output order changed");
  });
}

function registerWithdrawalRequestSelectionTests(): void {
  it("filters not-ready deposits when requesting ready withdrawals only", async () => {
    const { manager, ownerLock, depositHeader, requestedDeposit } =
      requestWithdrawalFixture();
    const notReadyDeposit = { ...requestedDeposit, isReady: false };
    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [notReadyDeposit],
      ownerLock,
      clientForDepositHeader(depositHeader),
      { isReadyOnly: true },
    );

    expect(tx.outputs).toEqual([]);
  });

  it("rejects duplicated or already spent withdrawal deposits", async () => {
    const { manager, ownerLock, depositHeader, requestedDeposit } =
      requestWithdrawalFixture();
    const spentTx = ccc.Transaction.default();
    spentTx.addInput(requestedDeposit.cell);

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit, requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
      ),
    ).rejects.toThrow("Withdrawal deposit is duplicated");
    await expect(
      manager.requestWithdrawal(
        spentTx,
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
      ),
    ).rejects.toThrow("Withdrawal deposit is already being spent");
  });
}

function withdrawalGroupFixture({
  isReady,
  daoScript,
  ownedOwnerScript,
  depositHeader,
}: WithdrawalGroupFixtureOptions): WithdrawalGroup {
  const ownedCell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("ef"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: ownedOwnerScript,
      type: daoScript,
    },
    outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
  });
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("ef"), index: 1n },
      cellOutput: { capacity: 61n, lock: script("44"), type: ownedOwnerScript },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    }),
  );
  const owned: DaoWithdrawalRequestCell = {
    cell: ownedCell,
    headers: [
      { header: depositHeader },
      { header: depositHeader, txHash: ownedCell.outPoint.txHash },
    ],
    ckbValue: ownedCell.cellOutput.capacity,
    udtValue: 0n,
    interests: 0n,
    maturity: depositHeader.epoch,
    isDeposit: false,
    isReady,
  };
  return new WithdrawalGroup(owned, owner);
}

class NoRequestOutputDaoManager extends DaoManager {
  constructor(daoScript: ccc.Script) {
    super(daoScript, []);
  }

  public override async requestWithdrawal(
    txLike: ccc.TransactionLike,
  ): Promise<ccc.Transaction> {
    await Promise.resolve();
    return ccc.Transaction.from(txLike);
  }
}

class MalformedRequestOutputDaoManager extends DaoManager {
  constructor(daoScript: ccc.Script) {
    super(daoScript, []);
  }

  public override async requestWithdrawal(
    txLike: ccc.TransactionLike,
  ): Promise<ccc.Transaction> {
    await Promise.resolve();
    const tx = ccc.Transaction.from(txLike);
    tx.addOutput({ capacity: 1n, lock: script("99"), type: this.script }, "0x");
    return tx;
  }
}

class FastWithdrawDaoManager extends DaoManager {
  public override async withdraw(
    txLike: ccc.TransactionLike | ccc.Transaction,
    withdrawalRequests: DaoWithdrawalRequestCell[],
  ): Promise<ccc.Transaction> {
    await Promise.resolve();
    const tx = ccc.Transaction.from(txLike);
    for (const withdrawalRequest of withdrawalRequests) {
      tx.addInput(withdrawalRequest.cell);
    }
    return tx;
  }
}

interface WithdrawalGroupFixtureOptions {
  isReady: boolean;
  daoScript: ccc.Script;
  ownedOwnerScript: ccc.Script;
  depositHeader: ccc.ClientBlockHeader;
}
