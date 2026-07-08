import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
} from "@ickb/testkit";
import { ickbDepositCellFrom, type IckbDepositCell } from "../../../src/cells.ts";
import { OwnerData } from "../../../src/entities.ts";
import { OwnedOwnerManager } from "../../../src/owned_owner.ts";

export const FIND_WITHDRAWAL_GROUPS_SUITE = "OwnedOwnerManager.findWithdrawalGroups";
export const REQUEST_WITHDRAWAL_SUITE = "OwnedOwnerManager.requestWithdrawal";

export function twoOwnerWithdrawalFixture(): TwoOwnerWithdrawalFixture {
  const ownerLock = script("11");
  const ownedOwnerScript = script("22");
  const daoScript = script("33");
  const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
  return {
    manager: new OwnedOwnerManager(ownedOwnerScript, [], new DaoManager(daoScript, [])),
    ownerLock,
    tip: headerLike(),
    depositHeader,
    withdrawalHeader: headerLike({ hash: byte32FromByte("aa"), number: 2n }),
    firstOwner: ownerMarkerCell("88", 1n, ownerLock, ownedOwnerScript),
    secondOwner: ownerMarkerCell("99", 1n, ownerLock, ownedOwnerScript),
    firstOwned: ownedWithdrawalCell({
      txHashByte: "88",
      index: 0n,
      ownedOwnerScript,
      daoScript,
      depositHeaderNumber: depositHeader.number,
    }),
    secondOwned: ownedWithdrawalCell({
      txHashByte: "99",
      index: 0n,
      ownedOwnerScript,
      daoScript,
      depositHeaderNumber: depositHeader.number,
    }),
  };
}

export function twoOwnerPendingPair<T>(): TwoOwnerPendingPair<T> {
  const { promise: first, resolve: resolveFirst } = Promise.withResolvers<T>();
  const { promise: second, resolve: resolveSecond } = Promise.withResolvers<T>();
  return { first, second, resolveFirst, resolveSecond };
}

export function requestWithdrawalFixture(): RequestWithdrawalFixture {
  const ownedOwnerScript = script("22");
  const daoScript = script("33");
  const ownerLock = script("44");
  const depositHeader = headerLike({ number: 1n });
  return {
    manager: new OwnedOwnerManager(ownedOwnerScript, [], new DaoManager(daoScript, [])),
    ownerLock,
    depositHeader,
    requestedDeposit: depositCell("55", ownedOwnerScript, daoScript, depositHeader),
    requiredLiveDeposit: depositCell("66", ownedOwnerScript, daoScript, depositHeader),
  };
}

export function depositCell(
  txHashByte: string,
  lock: ccc.Script,
  dao: ccc.Script,
  depositHeader: ccc.ClientBlockHeader,
): IckbDepositCell {
  const txHash = byte32FromByte(txHashByte);
  const cell = ccc.Cell.from({
    outPoint: { txHash, index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock,
      type: dao,
    },
    outputData: DaoManager.depositData(),
  });
  return ickbDepositCellFrom(
    {
      cell,
      headers: [{ header: depositHeader, txHash }, { header: depositHeader }],
      ckbValue: cell.cellOutput.capacity,
      udtValue: 0n,
      interests: 0n,
      maturity: depositHeader.epoch,
      isDeposit: true,
      isReady: true,
    },
    lock,
  );
}

export function ownerMarkerCell(
  txHashByte: string,
  index: bigint,
  ownerLock: ccc.Script,
  ownedOwnerScript: ccc.Script,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index },
    cellOutput: {
      capacity: 61n,
      lock: ownerLock,
      type: ownedOwnerScript,
    },
    outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
  });
}

export function ownedWithdrawalCell({
  txHashByte,
  index,
  ownedOwnerScript,
  daoScript,
  depositHeaderNumber,
}: OwnedWithdrawalCellOptions): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: ownedOwnerScript,
      type: daoScript,
    },
    outputData: ccc.mol.Uint64LE.encode(depositHeaderNumber),
  });
}

export function clientForDepositHeader(depositHeader: ccc.ClientBlockHeader): ccc.Client {
  return new StubClient({
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return transactionWithHeader(depositHeader);
    },
  });
}

interface OwnedWithdrawalCellOptions {
  txHashByte: string;
  index: bigint;
  ownedOwnerScript: ccc.Script;
  daoScript: ccc.Script;
  depositHeaderNumber: bigint;
}

interface TwoOwnerWithdrawalFixture {
  manager: OwnedOwnerManager;
  ownerLock: ccc.Script;
  tip: ccc.ClientBlockHeader;
  depositHeader: ccc.ClientBlockHeader;
  withdrawalHeader: ccc.ClientBlockHeader;
  firstOwner: ccc.Cell;
  secondOwner: ccc.Cell;
  firstOwned: ccc.Cell;
  secondOwned: ccc.Cell;
}

interface RequestWithdrawalFixture {
  manager: OwnedOwnerManager;
  ownerLock: ccc.Script;
  depositHeader: ccc.ClientBlockHeader;
  requestedDeposit: IckbDepositCell;
  requiredLiveDeposit: IckbDepositCell;
}

interface TwoOwnerPendingPair<T> {
  first: Promise<T>;
  second: Promise<T>;
  resolveFirst: (value: T | PromiseLike<T>) => void;
  resolveSecond: (value: T | PromiseLike<T>) => void;
}

export {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
};
