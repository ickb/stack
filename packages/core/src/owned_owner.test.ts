import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collect } from "@ickb/utils";
import { DaoManager } from "@ickb/dao";
import { OwnerData } from "./entities.js";
import { OwnerCell, type IckbDepositCell } from "./cells.js";
import { ickbValue } from "./udt.js";
import { OwnedOwnerManager } from "./owned_owner.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("fails closed when owner scanning exceeds the limit", async () => {
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
    let requestedLimit = 0;
    const client = {
      findCells: async function* (_query: unknown, _order: unknown, limit: number) {
        requestedLimit = limit;
        await Promise.resolve();
        yield firstOwner;
        yield secondOwner;
      },
    } as unknown as ccc.Client;

    await expect(
      collect(manager.findWithdrawalGroups(client, [ownerLock], { tip, limit: 1 })),
    ).rejects.toThrow("owner cell scan reached limit 1; state may be incomplete");
    expect(requestedLimit).toBe(2);
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

describe("OwnedOwnerManager.requestWithdrawal", () => {
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
    const ownerAOutput = tx.outputs[3];
    const ownerAData = tx.outputsData[3];
    const ownerBOutput = tx.outputs[4];
    const ownerBData = tx.outputsData[4];
    if (!ownerAOutput || ownerAData === undefined || !ownerBOutput || ownerBData === undefined) {
      throw new Error("Expected owner outputs");
    }
    const ownerA = new OwnerCell(ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 3n },
      cellOutput: ownerAOutput,
      outputData: ownerAData,
    }));
    const ownerB = new OwnerCell(ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("99"), index: 4n },
      cellOutput: ownerBOutput,
      outputData: ownerBData,
    }));
    expect(ownerA.getOwned().index).toBe(1n);
    expect(ownerB.getOwned().index).toBe(2n);
  });

  it("adds required live deposit anchors as cell deps", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const ownerLock = script("44");
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const depositHeader = headerLike({ number: 1n });
    const requestedDeposit = depositCell("55", ownedOwnerScript, daoScript, depositHeader);
    const requiredLiveDeposit = depositCell("66", ownedOwnerScript, daoScript, depositHeader);

    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [requestedDeposit],
      ownerLock,
      clientForDepositHeader(depositHeader),
      { requiredLiveDeposits: [requiredLiveDeposit] },
    );

    expect(tx.cellDeps).toContainEqual(
      ccc.CellDep.from({
        outPoint: requiredLiveDeposit.cell.outPoint,
        depType: "code",
      }),
    );
  });

  it("rejects duplicated or already spent withdrawal deposits", async () => {
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const ownerLock = script("44");
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const depositHeader = headerLike({ number: 1n });
    const requestedDeposit = depositCell("55", ownedOwnerScript, daoScript, depositHeader);
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

  it("rejects invalid required live deposit anchors", async () => {
    const ownedOwnerScript = script("22");
    const daoScript = script("33");
    const ownerLock = script("44");
    const manager = new OwnedOwnerManager(
      ownedOwnerScript,
      [],
      new DaoManager(daoScript, []),
    );
    const depositHeader = headerLike({ number: 1n });
    const requestedDeposit = depositCell("55", ownedOwnerScript, daoScript, depositHeader);
    const requiredLiveDeposit = depositCell("66", ownedOwnerScript, daoScript, depositHeader);
    const notReadyLiveDeposit = {
      ...requiredLiveDeposit,
      isReady: false,
    } as IckbDepositCell;
    const spentTx = ccc.Transaction.default();
    spentTx.addInput(requiredLiveDeposit.cell);

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [notReadyLiveDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is not ready");
    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [requiredLiveDeposit, requiredLiveDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is duplicated");
    await expect(
      manager.requestWithdrawal(
        spentTx,
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [requiredLiveDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is also being spent");
    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [requestedDeposit],
        ownerLock,
        clientForDepositHeader(depositHeader),
        { requiredLiveDeposits: [requestedDeposit] },
      ),
    ).rejects.toThrow("Withdrawal live deposit anchor is also being spent");
  });
});

function depositCell(
  txHashByte: string,
  lock: ccc.Script,
  dao: ccc.Script,
  depositHeader: ccc.ClientBlockHeader,
): IckbDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock,
      type: dao,
    },
    outputData: DaoManager.depositData(),
  });
  return {
    cell,
    headers: [{ header: depositHeader }],
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
    isDeposit: true,
    isReady: true,
  } as unknown as IckbDepositCell;
}

function clientForDepositHeader(depositHeader: ccc.ClientBlockHeader): ccc.Client {
  return {
    getTransactionWithHeader: async () => {
      await Promise.resolve();
      return { header: depositHeader };
    },
  } as unknown as ccc.Client;
}
