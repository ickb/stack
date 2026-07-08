import { ccc } from "@ckb-ccc/core";
import {
  ickbDepositCellFrom,
  OwnerCell,
  OwnerData,
  ReceiptData,
  WithdrawalGroup,
  type IckbDepositCell,
  type ReceiptCell,
} from "@ickb/core";
import { DaoManager, type DaoWithdrawalRequestCell } from "@ickb/dao";
import { script } from "@ickb/testkit";
import { baseTip, hash } from "../../../transaction/base/support/sdk_core_support.ts";

export function depositCell(
  ...[byte, logic, dao, depositHeader, tipHeader, options]: [
    byte: string,
    logic: ccc.Script,
    dao: ccc.Script,
    depositHeader: ccc.ClientBlockHeader,
    tipHeader: ccc.ClientBlockHeader,
    options?: { isReady?: boolean },
  ]
): IckbDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: logic,
      type: dao,
    },
    outputData: DaoManager.depositData(),
  });
  const deposit = ickbDepositCellFrom(
    {
      cell,
      headers: [
        { header: depositHeader, txHash: cell.outPoint.txHash },
        { header: tipHeader },
      ],
      interests: 0n,
      maturity: ccc.Epoch.from([1n, 0n, 1n]),
      isReady: options?.isReady ?? false,
      isDeposit: true,
      ckbValue: cell.cellOutput.capacity,
      udtValue: 0n,
    },
    logic,
  );
  Object.assign(deposit, { udtValue: ccc.fixedPointFrom(100000) });
  return deposit;
}

export function projectionReadyDeposit(
  udtValue: bigint,
  maturityUnix = 0n,
  options: { ckbValue?: bigint; id?: string; isReady?: boolean } = {},
): IckbDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(options.id ?? "aa"), index: maturityUnix },
    cellOutput: {
      capacity: 0n,
      lock: script("22"),
      type: script("33"),
    },
    outputData: DaoManager.depositData(),
  });
  const deposit = ickbDepositCellFrom(
    {
      cell,
      headers: [{ header: baseTip, txHash: cell.outPoint.txHash }, { header: baseTip }],
      interests: 0n,
      isReady: options.isReady ?? true,
      isDeposit: true,
      ckbValue: cell.cellOutput.capacity,
      udtValue: 0n,
      maturity: new TestEpoch(maturityUnix),
    },
    script("22"),
  );
  Object.assign(deposit, {
    ckbValue: options.ckbValue ?? udtValue,
    udtValue,
  });
  return deposit;
}

export function receiptValue(
  ckbValue: bigint,
  udtValue: bigint,
  byte = "20",
): ReceiptCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity: ckbValue, lock: script("11"), type: script("22") },
    outputData: "0x",
  });
  return {
    cell,
    header: { header: baseTip, txHash: cell.outPoint.txHash },
    ckbValue,
    udtValue,
  };
}

export function plainCapacityCell(
  capacity: bigint,
  lock = script("11"),
  byte = "10",
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}

export function nativeUdtCell(
  udtValue: bigint,
  options: {
    capacity?: bigint;
    lock?: ccc.Script;
    type?: ccc.Script;
    byte?: string;
  } = {},
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(options.byte ?? "40"), index: 0n },
    cellOutput: {
      capacity: options.capacity ?? 0n,
      lock: options.lock ?? script("11"),
      type: options.type ?? script("66"),
    },
    outputData: ccc.numLeToBytes(udtValue, 16),
  });
}

export function receiptCell(
  byte: string,
  lock: ccc.Script,
  logic: ccc.Script,
  header: ccc.ClientBlockHeader,
): ReceiptCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock,
      type: logic,
    },
    outputData: ReceiptData.encode({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }),
  });
  return {
    cell,
    header: { header, txHash: cell.outPoint.txHash },
    ckbValue: cell.cellOutput.capacity,
    udtValue: ccc.fixedPointFrom(100000),
  };
}

export function withdrawalValue(options: {
  ckbValue: bigint;
  udtValue?: bigint;
  isReady: boolean;
  maturityUnix?: bigint;
  byte?: string;
}): WithdrawalGroup {
  return new ProjectionWithdrawalGroup(options);
}

export function readyWithdrawalGroup(options: {
  ownerLock: ccc.Script;
  ownedOwner: ccc.Script;
  dao: ccc.Script;
  depositHeader: ccc.ClientBlockHeader;
  withdrawalHeader: ccc.ClientBlockHeader;
}): WithdrawalGroup {
  const ownedCell = ccc.Cell.from({
    outPoint: { txHash: hash("75"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: options.ownedOwner,
      type: options.dao,
    },
    outputData: ccc.mol.Uint64LE.encode(options.depositHeader.number),
  });
  const owner = new OwnerCell(
    ccc.Cell.from({
      outPoint: { txHash: hash("75"), index: 1n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(61),
        lock: options.ownerLock,
        type: options.ownedOwner,
      },
      outputData: OwnerData.encode({ ownedDistance: -1n }),
    }),
  );
  return new WithdrawalGroup(
    {
      cell: ownedCell,
      headers: [
        { header: options.depositHeader },
        { header: options.withdrawalHeader, txHash: ownedCell.outPoint.txHash },
      ],
      interests: 0n,
      maturity: ccc.Epoch.from([1n, 0n, 1n]),
      isReady: true,
      isDeposit: false,
      ckbValue: ownedCell.cellOutput.capacity,
      udtValue: 0n,
    },
    owner,
  );
}

class ProjectionWithdrawalGroup extends WithdrawalGroup {
  private readonly projection: { ckbValue: bigint; udtValue: bigint };

  constructor(options: {
    ckbValue: bigint;
    udtValue?: bigint;
    isReady: boolean;
    maturityUnix?: bigint;
    byte?: string;
  }) {
    const owned = {
      cell: ccc.Cell.from({
        outPoint: { txHash: hash(options.byte ?? "30"), index: 0n },
        cellOutput: {
          capacity: options.ckbValue,
          lock: script("44"),
          type: script("33"),
        },
        outputData: ccc.mol.Uint64LE.encode(baseTip.number),
      }),
      headers: [
        { header: baseTip },
        { header: baseTip, txHash: hash(options.byte ?? "30") },
      ],
      interests: 0n,
      maturity: new TestEpoch(options.maturityUnix ?? 0n),
      isReady: options.isReady,
      isDeposit: false,
      ckbValue: options.ckbValue,
      udtValue: options.udtValue ?? 0n,
    } satisfies DaoWithdrawalRequestCell;
    super(
      owned,
      new OwnerCell(
        ccc.Cell.from({
          outPoint: { txHash: hash(options.byte ?? "30"), index: 1n },
          cellOutput: { capacity: 0n, lock: script("11"), type: script("44") },
          outputData: OwnerData.encode({ ownedDistance: -1n }),
        }),
      ),
    );
    this.projection = {
      ckbValue: options.ckbValue,
      udtValue: options.udtValue ?? 0n,
    };
  }

  public override get ckbValue(): bigint {
    return this.projection.ckbValue;
  }

  public override get udtValue(): bigint {
    return this.projection.udtValue;
  }
}

class TestEpoch extends ccc.Epoch {
  private readonly unix: bigint;

  constructor(unix: bigint) {
    super(1n, 0n, 1n);
    this.unix = unix;
  }

  public override toUnix(): bigint {
    return this.unix;
  }
}

export const placeholderReceipt = receiptValue(0n, 0n, "21");
export const placeholderWithdrawal = withdrawalValue({
  ckbValue: 0n,
  isReady: true,
  byte: "31",
});
