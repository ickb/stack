import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { collect } from "@ickb/utils";
import { DaoManager } from "@ickb/dao";
import { OwnerData } from "./entities.js";
import { OwnerCell } from "./cells.js";
import { ickbValue } from "./udt.js";
import { OwnedOwnerManager } from "./owned_owner.js";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function headerLike(
  overrides: Partial<ccc.ClientBlockHeaderLike> = {},
): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
    epoch: [181n, 0n, 1n],
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number: 3n,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp: 0n,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
    ...overrides,
  });
}

describe("OwnedOwnerManager.findWithdrawalGroups", () => {
  it("decodes owner relative distances from prefixed data", () => {
    const ownerCell = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("55"), index: 1n },
        cellOutput: {
          capacity: 61n,
          lock: script("11"),
          type: script("22"),
        },
        outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
      }),
    );

    expect(ownerCell.getOwned().index).toBe(0n);
  });

  it("skips owners whose referenced withdrawal is not locked by Owned Owner", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const outsiderLock = script("44");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const ownerCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const fakeOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: outsiderLock,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const client = {
      getTipHeader: async () => {
        await Promise.resolve();
        return tip;
      },
      findCells: async function* () {
        await Promise.resolve();
        yield ownerCell;
      },
      getCell: async () => {
        await Promise.resolve();
        return fakeOwned;
      },
      getHeaderByNumber: async () => {
        await Promise.resolve();
        return headerLike();
      },
      getTransactionWithHeader: async () => {
        await Promise.resolve();
        return { header: tip };
      },
    } as unknown as ccc.Client;

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
  });

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
    const ownerCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("77"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
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
    const client = {
      getTipHeader: async () => {
        await Promise.resolve();
        return tip;
      },
      findCells: async function* () {
        await Promise.resolve();
        yield ownerCell;
      },
      getCell: async () => {
        await Promise.resolve();
        return fakeOwned;
      },
      getHeaderByNumber: async () => {
        headerLookups += 1;
        await Promise.resolve();
        return headerLike();
      },
      getTransactionWithHeader: async () => {
        headerLookups += 1;
        await Promise.resolve();
        return { header: tip };
      },
    } as unknown as ccc.Client;

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
    expect(headerLookups).toBe(0);
  });

  it("skips referenced cells that are not DAO withdrawal requests", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const foreignType = script("44");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const firstOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const secondOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("66"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: "0x0000000000000000",
    });
    const foreignCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("66"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: foreignType,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const referencedCells = new Map([
      [deposit.outPoint.toHex(), deposit],
      [foreignCell.outPoint.toHex(), foreignCell],
    ]);
    const client = {
      getTipHeader: async () => {
        await Promise.resolve();
        return tip;
      },
      findCells: async function* () {
        await Promise.resolve();
        yield firstOwner;
        yield secondOwner;
      },
      getCell: async (outPoint: ccc.OutPoint) => {
        await Promise.resolve();
        return referencedCells.get(outPoint.toHex());
      },
      getHeaderByNumber: async () => {
        await Promise.resolve();
        return headerLike();
      },
      getTransactionWithHeader: async () => {
        await Promise.resolve();
        return { header: tip };
      },
    } as unknown as ccc.Client;

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toEqual([]);
  });

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
    const ownerCell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const depositHeader = headerLike({
      epoch: [1n, 0n, 1n],
      number: 1n,
    });
    const withdrawalHeader = headerLike({
      hash: byte32FromByte("99"),
      number: 2n,
    });
    const owned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    const client = {
      getTipHeader: async () => {
        await Promise.resolve();
        return tip;
      },
      findCells: async function* () {
        await Promise.resolve();
        yield ownerCell;
      },
      getCell: async () => {
        await Promise.resolve();
        return owned;
      },
      getHeaderByNumber: async () => {
        await Promise.resolve();
        return depositHeader;
      },
      getTransactionWithHeader: async () => {
        await Promise.resolve();
        return { header: withdrawalHeader };
      },
    } as unknown as ccc.Client;

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.udtValue).toBe(ickbValue(owned.capacityFree, depositHeader));
  });
});
