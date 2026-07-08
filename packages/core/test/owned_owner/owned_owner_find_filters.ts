import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnedOwnerManager } from "../../src/owned_owner.ts";
import { ickbValue } from "../../src/udt.ts";
import {
  byte32FromByte,
  FIND_WITHDRAWAL_GROUPS_SUITE,
  headerLike,
  ownedWithdrawalCell,
  ownerMarkerCell,
  script,
  StubClient,
  transactionWithHeader,
} from "./support/owned_owner_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(FIND_WITHDRAWAL_GROUPS_SUITE, () => {
  registerOwnerLockFilterTests();
  registerPreDecodeFilterTests();
  registerWithdrawalTypeFilterTests();
  registerWithdrawalValueTests();
});

function registerOwnerLockFilterTests(): void {
  it("skips owners whose referenced withdrawal is not locked by Owned Owner", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const ownerCell = ownerMarkerCell("55", 1n, ownerLock, ownedOwnerScript);
    const fakeOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("44"),
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const client = clientWithSingleOwned(tip, ownerCell, fakeOwned);

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
  });
}

function registerPreDecodeFilterTests(): void {
  it("skips owner targets before DAO header decoding", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const ownerCell = ownerMarkerCell("77", 1n, ownerLock, ownedOwnerScript);
    const fakeOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("77"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: script("44"),
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    let headerLookups = 0;
    const client = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        await Promise.resolve();
        return tip;
      },
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield ownerCell;
      },
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return fakeOwned;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        headerLookups += 1;
        await Promise.resolve();
        return headerLike();
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        headerLookups += 1;
        await Promise.resolve();
        return transactionWithHeader(tip);
      },
    });

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
    expect(headerLookups).toBe(0);
  });
}

function registerWithdrawalTypeFilterTests(): void {
  it("skips referenced cells that are not DAO withdrawal requests", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const firstOwner = ownerMarkerCell("55", 1n, ownerLock, ownedOwnerScript);
    const secondOwner = ownerMarkerCell("66", 1n, ownerLock, ownedOwnerScript);
    const deposit = referencedCell(
      "55",
      ownedOwnerScript,
      daoScript,
      DaoManager.depositData(),
    );
    const foreignCell = referencedCell(
      "66",
      ownedOwnerScript,
      script("44"),
      ccc.mol.Uint64LE.encode(1n),
    );
    const client = clientWithReferencedCells(
      tip,
      [firstOwner, secondOwner],
      [deposit, foreignCell],
    );

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
  });
}

function registerWithdrawalValueTests(): void {
  it("keeps withdrawal-group iCKB value from the referenced deposit header", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const ownerCell = ownerMarkerCell("88", 1n, ownerLock, ownedOwnerScript);
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const withdrawalHeader = headerLike({ hash: byte32FromByte("99"), number: 2n });
    const owned = ownedWithdrawalCell({
      txHashByte: "88",
      index: 0n,
      ownedOwnerScript,
      daoScript,
      depositHeaderNumber: depositHeader.number,
    });
    const client = new StubClient({
      getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
        await Promise.resolve();
        return tip;
      },
      async *findCells(): ReturnType<ccc.Client["findCells"]> {
        await Promise.resolve();
        yield ownerCell;
      },
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return owned;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return depositHeader;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(withdrawalHeader);
      },
    });

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.udtValue).toBe(ickbValue(owned.capacityFree, depositHeader));
  });
}

function clientWithSingleOwned(
  tip: ccc.ClientBlockHeader,
  owner: ccc.Cell,
  owned: ccc.Cell,
): ccc.Client {
  return clientWithReferencedCells(tip, [owner], [owned]);
}

function clientWithReferencedCells(
  tip: ccc.ClientBlockHeader,
  owners: ccc.Cell[],
  referenced: ccc.Cell[],
): ccc.Client {
  const referencedCells = new Map(
    referenced.map((cell) => [cell.outPoint.toHex(), cell]),
  );
  return new StubClient({
    getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
      await Promise.resolve();
      return tip;
    },
    async *findCells(): ReturnType<ccc.Client["findCells"]> {
      await Promise.resolve();
      yield* owners;
    },
    getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
      await Promise.resolve();
      return referencedCells.get(ccc.OutPoint.from(outPoint).toHex());
    },
    getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      return headerLike();
    },
    getTransactionWithHeader: async (): ReturnType<
      ccc.Client["getTransactionWithHeader"]
    > => {
      await Promise.resolve();
      return transactionWithHeader(tip);
    },
  });
}

function referencedCell(
  txHashByte: string,
  lock: ccc.Script,
  type: ccc.Script,
  outputData: ccc.BytesLike,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type },
    outputData,
  });
}
