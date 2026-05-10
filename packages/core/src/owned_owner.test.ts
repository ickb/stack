import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
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

  it("fetches referenced owned cells concurrently and yields in owner scan order", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const firstOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const secondOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 1n },
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
      hash: byte32FromByte("aa"),
      number: 2n,
    });
    const firstOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    const secondOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    let resolveFirst!: (cell: ccc.Cell | undefined) => void;
    let resolveSecond!: (cell: ccc.Cell | undefined) => void;
    const firstFetch = new Promise<ccc.Cell | undefined>((resolve) => {
      resolveFirst = resolve;
    });
    const secondFetch = new Promise<ccc.Cell | undefined>((resolve) => {
      resolveSecond = resolve;
    });
    const pending = new Map([
      [firstOwned.outPoint.toHex(), firstFetch],
      [secondOwned.outPoint.toHex(), secondFetch],
    ]);
    const fetches: ccc.OutPoint[] = [];
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
        fetches.push(outPoint);
        const fetch = pending.get(outPoint.toHex());
        if (!fetch) {
          throw new Error("Unexpected getCell out point");
        }
        return fetch;
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

    const groupsPromise = collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    await vi.waitFor(() => {
      expect(fetches).toHaveLength(2);
    });
    expect(fetches.map((outPoint) => outPoint.toHex())).toEqual([
      firstOwned.outPoint.toHex(),
      secondOwned.outPoint.toHex(),
    ]);

    resolveSecond(secondOwned);
    await Promise.resolve();
    resolveFirst(firstOwned);

    const groups = await groupsPromise;

    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual([
      firstOwner.outPoint.toHex(),
      secondOwner.outPoint.toHex(),
    ]);
  });

  it("decodes referenced withdrawals concurrently and yields in owner scan order", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const firstOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const secondOwner = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 1n },
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
      hash: byte32FromByte("aa"),
      number: 2n,
    });
    const firstOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    const secondOwned = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
    });
    const referencedCells = new Map([
      [firstOwned.outPoint.toHex(), firstOwned],
      [secondOwned.outPoint.toHex(), secondOwned],
    ]);
    const headerRequests: ccc.Hex[] = [];
    let resolveFirst!: (res: { header: ccc.ClientBlockHeader }) => void;
    let resolveSecond!: (res: { header: ccc.ClientBlockHeader }) => void;
    const firstWithdrawalFetch = new Promise<{ header: ccc.ClientBlockHeader }>((resolve) => {
      resolveFirst = resolve;
    });
    const secondWithdrawalFetch = new Promise<{ header: ccc.ClientBlockHeader }>((resolve) => {
      resolveSecond = resolve;
    });
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
        return depositHeader;
      },
      getTransactionWithHeader: async (txHash: ccc.Hex) => {
        headerRequests.push(txHash);
        return txHash === firstOwned.outPoint.txHash
          ? firstWithdrawalFetch
          : secondWithdrawalFetch;
      },
    } as unknown as ccc.Client;

    const groupsPromise = collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    await vi.waitFor(() => {
      expect(headerRequests).toEqual([
        firstOwned.outPoint.txHash,
        secondOwned.outPoint.txHash,
      ]);
    });
    resolveSecond({ header: withdrawalHeader });
    await Promise.resolve();
    resolveFirst({ header: withdrawalHeader });

    const groups = await groupsPromise;

    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual([
      firstOwner.outPoint.toHex(),
      secondOwner.outPoint.toHex(),
    ]);
  });

  it("deduplicates referenced withdrawal header lookups during a scan", async () => {
    const ownerLock = script("11");
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const tip = headerLike();
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const txHash = byte32FromByte("88");
    const firstOwner = ccc.Cell.from({
      outPoint: { txHash, index: 1n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const secondOwner = ccc.Cell.from({
      outPoint: { txHash, index: 3n },
      cellOutput: {
        capacity: 61n,
        lock: ownerLock,
        type: ownedOwnerScript,
      },
      outputData: OwnerData.from({ ownedDistance: -1n }).toBytes(),
    });
    const firstOwned = ccc.Cell.from({
      outPoint: { txHash, index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const secondOwned = ccc.Cell.from({
      outPoint: { txHash, index: 2n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: ownedOwnerScript,
        type: daoScript,
      },
      outputData: ccc.mol.Uint64LE.encode(1n),
    });
    const referencedCells = new Map([
      [firstOwned.outPoint.toHex(), firstOwned],
      [secondOwned.outPoint.toHex(), secondOwned],
    ]);
    let headerCalls = 0;
    let transactionCalls = 0;
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
        headerCalls += 1;
        await Promise.resolve();
        return headerLike({ number: 1n });
      },
      getTransactionWithHeader: async () => {
        transactionCalls += 1;
        await Promise.resolve();
        return { header: headerLike({ number: 2n }) };
      },
    } as unknown as ccc.Client;

    const groups = await collect(
      manager.findWithdrawalGroups(client, [ownerLock], { tip }),
    );

    expect(groups).toHaveLength(2);
    expect(headerCalls).toBe(1);
    expect(transactionCalls).toBe(1);
  });
});
