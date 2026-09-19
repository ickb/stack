import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  headerLike,
  script,
  StubClient,
  transactionWithHeader,
} from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  DAO_HEADER_INDEX_LIMIT,
  DAO_OUTPUT_LIMIT,
  daoClaimEpoch,
  DaoHeaderIndexError,
  DaoOutputLimitError,
  depositData,
} from "../../src/dao.ts";
import type { IckbDepositCell } from "../../src/logic.ts";
import {
  decodeOwnerData,
  encodeOwnerData,
  OwnedOwnerManager,
  OwnerCell,
  WithdrawalGroup,
  withdrawalRequestCell,
  type DaoWithdrawalRequestCell,
} from "../../src/owned_owner.ts";
import { ickbValue } from "../../src/udt.ts";

const ownedOwner = script("11", "0x1234");
const logic = script("22", "0x5678");
const dao = { script: script("33"), cellDeps: [] };
const userLock = script("44");

function manager(cellDeps: ccc.CellDep[] = []): OwnedOwnerManager {
  return new OwnedOwnerManager(ownedOwner, cellDeps, dao);
}

function depositOf(
  txHashByte: string,
  header = headerLike({ number: 1n }),
): IckbDepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao.script },
    outputData: depositData(),
  });
  return {
    cell,
    headers: [{ header, txHash: cell.outPoint.txHash }, { header }],
    interests: 0n,
    maturity: ccc.Epoch.from([1n, 0n, 1n]),
    isReady: true,
    ckbValue: cell.cellOutput.capacity,
    udtValue: 0n,
  };
}

function requestOf(
  depositHeader: ccc.ClientBlockHeader,
  requestHeader: ccc.ClientBlockHeader,
  txHashByte = "55",
): DaoWithdrawalRequestCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: ownedOwner,
      type: dao.script,
    },
    outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
  });
  return {
    cell,
    headers: [
      { header: depositHeader },
      { header: requestHeader, txHash: cell.outPoint.txHash },
    ],
    interests: 0n,
    maturity: ccc.Epoch.from([180n, 0n, 1n]),
    isReady: true,
    ckbValue: cell.cellOutput.capacity,
  };
}

/** A copy of the cell with some fields replaced, keeping CCC's class. */
function cellWith(
  cell: ccc.Cell,
  overrides: { outPoint?: ccc.OutPointLike; lock?: ccc.Script; outputData?: ccc.Hex },
): ccc.Cell {
  const cellOutput = cell.cellOutput.clone();
  cellOutput.lock = overrides.lock ?? cellOutput.lock;
  return ccc.Cell.from({
    outPoint: overrides.outPoint ?? cell.outPoint,
    cellOutput,
    outputData: overrides.outputData ?? cell.outputData,
  });
}

function ownerOf(owned: DaoWithdrawalRequestCell, ownedDistance = -1n): OwnerCell {
  return new OwnerCell(
    ccc.Cell.from({
      outPoint: {
        txHash: owned.cell.outPoint.txHash,
        index: owned.cell.outPoint.index - ownedDistance,
      },
      cellOutput: { capacity: 61n, lock: userLock, type: ownedOwner },
      outputData: encodeOwnerData({ ownedDistance }),
    }),
  );
}

describe("owner data", () => {
  it("matches the deployed owner data wire format", () => {
    const encoded = encodeOwnerData({ ownedDistance: -5n });

    expect(encoded).toHaveLength(4);
    expect(ccc.hexFrom(encoded)).toBe("0xfbffffff");
    expect(decodeOwnerData("0xfbffffffaabbcc").ownedDistance).toBe(-5n);
  });

  it("resolves the owned out point from the marker's own transaction", () => {
    const owned = requestOf(headerLike({ number: 1n }), headerLike({ number: 2n }));
    const owner = ownerOf(owned, -1n);

    expect(owner.getOwned().eq(owned.cell.outPoint)).toBe(true);
    expect(owner.ckbValue).toBe(owner.cell.cellOutput.capacity);
    expect(owner.udtValue).toBe(0n);
  });

  it("rejects owner markers that point before output zero", () => {
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 0n },
        cellOutput: { capacity: 61n, lock: userLock, type: ownedOwner },
        outputData: "0xffffffff",
      }),
    );

    expect(() => owner.getOwned()).toThrow(
      `Owner marker ${owner.cell.outPoint.toHex()} points before output 0`,
    );
  });

  it("rejects malformed owner marker payloads with out point context", () => {
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 0n },
        cellOutput: { capacity: 61n, lock: userLock, type: ownedOwner },
        outputData: "0x12",
      }),
    );

    expect(() => owner.getOwned()).toThrow(
      `Invalid owner marker payload at ${owner.cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("sums a withdrawal group's CKB and values its iCKB at the deposit header", () => {
    const depositHeader = headerLike({
      number: 1n,
      dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
    });
    const owned = requestOf(depositHeader, headerLike({ number: 2n }));
    const owner = ownerOf(owned);
    const group = new WithdrawalGroup(owned, owner);

    expect(group.ckbValue).toBe(owned.ckbValue + owner.cell.cellOutput.capacity);
    expect(group.udtValue).toBe(ickbValue(owned.cell.capacityFree, depositHeader));
  });
});

describe("OwnedOwnerManager cell shapes", () => {
  it("recognizes owner markers by type and decodable data, and owned requests by lock", () => {
    const target = manager();
    const owned = requestOf(headerLike({ number: 1n }), headerLike({ number: 2n }));
    const owner = ownerOf(owned);
    const undecodable = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("12"), index: 0n },
      cellOutput: { capacity: 61n, lock: userLock, type: ownedOwner },
      outputData: "0xffffffff",
    });
    const foreignLock = cellWith(owned.cell, { lock: userLock });

    expect(target.isOwner(owner.cell)).toBe(true);
    expect(target.isOwner(undecodable)).toBe(false);
    expect(target.isOwner(owned.cell)).toBe(false);
    expect(target.isOwned(owned.cell)).toBe(true);
    expect(target.isOwned(foreignLock)).toBe(false);
  });
});

describe("OwnedOwnerManager.requestWithdrawal", () => {
  it("leaves the transaction unchanged when no deposits are given", () => {
    const tx = ccc.Transaction.default();

    expect(manager().requestWithdrawal(tx, [], userLock)).toEqual(tx);
  });

  it("spends each deposit into a request and an owner marker pointing back at it", () => {
    const dep = ccc.CellDep.from({
      outPoint: { txHash: byte32FromByte("aa"), index: 0n },
      depType: "code",
    });
    const deposits = [
      depositOf("66"),
      depositOf("77", headerLike({ number: 2n, hash: byte32FromByte("cc") })),
    ];

    const tx = manager([dep]).requestWithdrawal(
      ccc.Transaction.default(),
      deposits,
      userLock,
    );

    expect(tx.cellDeps).toEqual([dep]);
    expect(tx.headerDeps).toEqual(
      deposits.map((deposit) => deposit.headers[0].header.hash),
    );
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual(
      deposits.map((deposit) => deposit.cell.outPoint.toHex()),
    );
    expect(tx.outputs).toHaveLength(4);
    expect(tx.outputs[0]?.lock.eq(ownedOwner)).toBe(true);
    expect(tx.outputs[0]?.type?.eq(dao.script)).toBe(true);
    expect(tx.outputsData[1]).toBe(ccc.hexFrom(ccc.mol.Uint64LE.encode(2n)));
    expect(tx.outputs[2]?.lock.eq(userLock)).toBe(true);
    expect(tx.outputs[2]?.type?.eq(ownedOwner)).toBe(true);
    expect(decodeOwnerData(tx.outputsData[2] ?? "0x").ownedDistance).toBe(-2n);
    expect(decodeOwnerData(tx.outputsData[3] ?? "0x").ownedDistance).toBe(-2n);
  });

  it("does not duplicate an existing deposit header dep", () => {
    const deposit = depositOf("66");
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(deposit.headers[0].header.hash);

    expect(manager().requestWithdrawal(tx, [deposit], userLock).headerDeps).toEqual([
      deposit.headers[0].header.hash,
    ]);
  });

  it("requires matched input and output counts before appending requests", () => {
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock: userLock }, "0x");

    expect(() => manager().requestWithdrawal(tx, [depositOf("66")], userLock)).toThrow(
      "Transaction has different inputs and outputs lengths",
    );
  });

  it("rejects a deposit whose header tx hash does not match the cell", () => {
    const deposit = depositOf("66");
    deposit.headers[0] = { ...deposit.headers[0], txHash: byte32FromByte("99") };

    expect(() =>
      manager().requestWithdrawal(ccc.Transaction.default(), [deposit], userLock),
    ).toThrow("header txHash");
  });

  it("rejects a deposit whose lock args differ in size from the request lock", () => {
    const deposit = depositOf("66");
    deposit.cell.cellOutput.lock = script("22", "0x12");

    expect(() =>
      manager().requestWithdrawal(ccc.Transaction.default(), [deposit], userLock),
    ).toThrow("Withdrawal request lock args has different size from deposit");
  });

  it("rejects output 65 after appending the owner markers", () => {
    const tx = ccc.Transaction.default();
    for (let index = 0; index < DAO_OUTPUT_LIMIT - 1; index += 1) {
      tx.addInput({
        previousOutput: { txHash: byte32FromByte("aa"), index: BigInt(index) },
      });
      tx.addOutput({ capacity: 1n, lock: userLock }, "0x");
    }

    expect(() => manager().requestWithdrawal(tx, [depositOf("66")], userLock)).toThrow(
      DaoOutputLimitError,
    );
  });
});

describe("OwnedOwnerManager.withdraw", () => {
  const depositHeader = headerLike({ number: 1n, hash: byte32FromByte("a1") });
  const requestHeader = headerLike({ number: 2n, hash: byte32FromByte("b1") });

  it("leaves the transaction unchanged when no groups are given", () => {
    const tx = ccc.Transaction.default();

    expect(manager().withdraw(tx, [])).toEqual(tx);
  });

  it("writes since, header deps, witness input types, then the owner inputs", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const owner = ownerOf(owned);

    const tx = manager().withdraw(ccc.Transaction.default(), [
      new WithdrawalGroup(owned, owner),
    ]);

    expect(tx.headerDeps).toEqual([depositHeader.hash, requestHeader.hash]);
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      owned.cell.outPoint.toHex(),
      owner.cell.outPoint.toHex(),
    ]);
    const since = tx.inputs[0]?.since;
    if (since === undefined) {
      throw new Error("Expected withdrawal input since");
    }
    expect(ccc.Since.from(since).metric).toBe("epoch");
    expect(ccc.Since.from(since).value).toBe(owned.maturity.toNum());
    expect(tx.getWitnessArgs(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
  });

  it("pushes every deposit header before any withdrawal header", () => {
    const first = requestOf(depositHeader, requestHeader, "55");
    const second = requestOf(
      headerLike({ number: 3n, hash: byte32FromByte("a2") }),
      headerLike({ number: 4n, hash: byte32FromByte("b2") }),
      "56",
    );

    const tx = manager().withdraw(ccc.Transaction.default(), [
      new WithdrawalGroup(first, ownerOf(first)),
      new WithdrawalGroup(second, ownerOf(second)),
    ]);

    expect(tx.headerDeps).toEqual([
      first.headers[0].header.hash,
      second.headers[0].header.hash,
      first.headers[1].header.hash,
      second.headers[1].header.hash,
    ]);
    expect(tx.getWitnessArgs(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
    expect(tx.getWitnessArgs(1)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(1n, 8)));
  });

  it("does not duplicate existing header deps", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(depositHeader.hash, requestHeader.hash);

    const updated = manager().withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]);

    expect(updated.headerDeps).toEqual([depositHeader.hash, requestHeader.hash]);
  });

  it("rejects a deposit header the deployed script cannot address", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    for (let index = 0; index < DAO_HEADER_INDEX_LIMIT; index += 1) {
      tx.headerDeps.push(ccc.hexFrom(ccc.numToBytes(index + 1, 32)));
    }

    expect(() =>
      manager().withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]),
    ).toThrow(DaoHeaderIndexError);
  });

  it("preserves an existing non-input witness by shifting it after the new input", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    const preservedWitness = ccc.WitnessArgs.from({ inputType: "0xab" }).toHex();
    tx.witnesses.push(preservedWitness);

    const updated = manager().withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]);

    expect(updated.getWitnessArgs(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
    expect(updated.witnesses[2]).toBe(preservedWitness);
  });

  it("rejects a withdrawal witness whose input type is already set", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    const addInput = tx.addInput.bind(tx);
    tx.addInput = (input): number => {
      const inputCount = addInput(input);
      tx.setWitnessArgs(inputCount - 1, ccc.WitnessArgs.from({ inputType: "0xab" }));
      return inputCount;
    };

    expect(() =>
      manager().withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]),
    ).toThrow("Witnesses of withdrawal request already in use");
  });

  it("rejects more than 64 outputs", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    for (let index = 0; index <= DAO_OUTPUT_LIMIT; index += 1) {
      tx.addOutput({ capacity: 1n, lock: userLock }, "0x");
    }

    expect(() =>
      manager().withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]),
    ).toThrow(DaoOutputLimitError);
  });

  it("rejects a group whose owner points at a different owned cell", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const other = requestOf(depositHeader, requestHeader, "56");

    expect(() =>
      manager().withdraw(ccc.Transaction.default(), [
        new WithdrawalGroup(owned, ownerOf(other)),
      ]),
    ).toThrow("but group owned cell is");
  });

  it("rejects a request whose header tx hash does not match the cell", () => {
    const owned = requestOf(depositHeader, requestHeader);
    owned.headers[1] = { ...owned.headers[1], txHash: byte32FromByte("99") };

    expect(() =>
      manager().withdraw(ccc.Transaction.default(), [
        new WithdrawalGroup(owned, ownerOf(owned)),
      ]),
    ).toThrow("header txHash");
  });
});

describe("withdrawalRequestCell", () => {
  const withdrawalCell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: ownedOwner,
      type: dao.script,
    },
    outputData: ccc.mol.Uint64LE.encode(1n),
  });

  it("marks requests ready once the claim epoch is reached", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const requestHeader = headerLike({ epoch: [180n, 0n, 1n], number: 2n });
    const tip = headerLike({ epoch: [181n, 0n, 1n], number: 3n });

    const cell = withdrawalRequestCell(
      withdrawalCell,
      depositHeader,
      { header: requestHeader, txHash: withdrawalCell.outPoint.txHash },
      tip,
    );

    expect(cell.maturity.eq(ccc.calcDaoClaimEpoch(depositHeader, requestHeader))).toBe(
      true,
    );
    expect(cell.isReady).toBe(true);
    expect(cell.ckbValue).toBe(
      withdrawalCell.cellOutput.capacity +
        ccc.calcDaoProfit(withdrawalCell.capacityFree, depositHeader, requestHeader),
    );
  });

  it("keeps requests pending before the claim epoch", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const requestHeader = headerLike({ epoch: [180n, 0n, 1n], number: 2n });
    const tip = headerLike({ epoch: [179n, 0n, 1n], number: 3n });

    expect(
      withdrawalRequestCell(
        withdrawalCell,
        depositHeader,
        { header: requestHeader, txHash: withdrawalCell.outPoint.txHash },
        tip,
      ).isReady,
    ).toBe(false);
  });

  it("does not add another cycle at an equal fractional epoch", () => {
    const depositHeader = headerLike({ epoch: [1n, 1n, 2n], number: 1n });
    const requestHeader = headerLike({ epoch: [181n, 1n, 2n], number: 2n });
    const tip = headerLike({ epoch: [181n, 1n, 2n], number: 3n });

    const cell = withdrawalRequestCell(
      withdrawalCell,
      depositHeader,
      { header: requestHeader, txHash: withdrawalCell.outPoint.txHash },
      tip,
    );

    expect(daoClaimEpoch(depositHeader, requestHeader).eq([181n, 1n, 2n])).toBe(true);
    expect(cell.maturity.eq([181n, 1n, 2n])).toBe(true);
    expect(cell.isReady).toBe(true);
  });
});

describe("OwnedOwnerManager.withdrawalGroupsFrom", () => {
  const depositHeader = headerLike({
    epoch: [1n, 0n, 1n],
    number: 1n,
    dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
  });
  const requestHeader = headerLike({
    epoch: [180n, 0n, 1n],
    number: 2n,
    hash: byte32FromByte("b1"),
  });
  const tip = headerLike({ epoch: [181n, 0n, 1n], number: 3n });

  function clientFor(
    owned: Map<string, ccc.Cell>,
    missing?: "request" | "deposit",
  ): {
    client: StubClient;
    calls: string[];
  } {
    const calls: string[] = [];
    const client = new StubClient({
      getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return owned.get(ccc.OutPoint.from(outPoint).toHex());
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        calls.push("deposit");
        await Promise.resolve();
        return missing === "deposit" ? undefined : depositHeader;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        calls.push("request");
        await Promise.resolve();
        return missing === "request" ? undefined : transactionWithHeader(requestHeader);
      },
    });
    return { client, calls };
  }

  it("pairs each owner marker with its owned request, reading each header once", async () => {
    const first = requestOf(depositHeader, requestHeader, "55");
    const second = requestOf(depositHeader, requestHeader, "55");
    Object.assign(second.cell.outPoint, { index: 2n });
    const owners = [ownerOf(first), ownerOf(second)];
    const { client, calls } = clientFor(
      new Map(
        [first, second].map((request) => [request.cell.outPoint.toHex(), request.cell]),
      ),
    );

    const groups = await manager().withdrawalGroupsFrom(
      client,
      owners.map((owner) => owner.cell),
      tip,
    );

    expect(calls).toEqual(["deposit", "request"]);
    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual(
      owners.map((owner) => owner.cell.outPoint.toHex()),
    );
    expect(groups[0]?.owned).toMatchObject({ isReady: true });
    expect(groups[0]?.owned.headers[1]).toEqual({
      header: requestHeader,
      txHash: first.cell.outPoint.txHash,
    });
    expect(groups[0]?.udtValue).toBe(ickbValue(first.cell.capacityFree, depositHeader));
  });

  it("skips markers whose target is missing, not a withdrawal request, or not owned", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    const foreignLock = cellWith(owned.cell, {
      outPoint: { txHash: byte32FromByte("56"), index: 0n },
      lock: userLock,
    });
    const deposit = cellWith(owned.cell, {
      outPoint: { txHash: byte32FromByte("57"), index: 0n },
      outputData: depositData(),
    });
    const missing = cellWith(owned.cell, {
      outPoint: { txHash: byte32FromByte("58"), index: 0n },
    });
    const owners = [
      ownerOf(owned),
      ownerOf({ ...owned, cell: foreignLock }),
      ownerOf({ ...owned, cell: deposit }),
      ownerOf({ ...owned, cell: missing }),
    ];
    const { client } = clientFor(
      new Map([
        [owned.cell.outPoint.toHex(), owned.cell],
        [foreignLock.outPoint.toHex(), foreignLock],
        [deposit.outPoint.toHex(), deposit],
      ]),
    );

    const groups = await manager().withdrawalGroupsFrom(
      client,
      owners.map((owner) => owner.cell),
      tip,
    );

    expect(groups.map((group) => group.owned.cell.outPoint.toHex())).toEqual([
      owned.cell.outPoint.toHex(),
    ]);
  });

  it("rejects an owned request whose payload cannot be decoded", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    owned.cell.outputData = "0x12";
    const { client } = clientFor(new Map([[owned.cell.outPoint.toHex(), owned.cell]]));

    await expect(
      manager().withdrawalGroupsFrom(client, [ownerOf(owned).cell], tip),
    ).rejects.toThrow(
      `Invalid DAO withdrawal request payload at ${owned.cell.outPoint.toHex()}: 0x12`,
    );
  });

  it("rejects a batch whose headers are unavailable", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    const cells = new Map([[owned.cell.outPoint.toHex(), owned.cell]]);
    const missingRequest = clientFor(cells, "request").client;
    const missingDeposit = clientFor(cells, "deposit").client;

    await expect(
      manager().withdrawalGroupsFrom(missingRequest, [ownerOf(owned).cell], tip),
    ).rejects.toThrow(`Header not found for txHash ${owned.cell.outPoint.txHash}`);
    await expect(
      manager().withdrawalGroupsFrom(missingDeposit, [ownerOf(owned).cell], tip),
    ).rejects.toThrow("Header not found for block number 1");
  });

  it("reads the deposit and request headers concurrently", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    const calls: string[] = [];
    const { promise: depositFetch, resolve: resolveDeposit } = Promise.withResolvers<
      ccc.ClientBlockHeader | undefined
    >();
    const { promise: requestFetch, resolve: resolveRequest } =
      Promise.withResolvers<
        Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>
      >();
    const client = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return owned.cell;
      },
      getHeaderByNumber: async (): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        calls.push("deposit");
        return depositFetch;
      },
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        calls.push("request");
        return requestFetch;
      },
    });

    const groupsPromise = manager().withdrawalGroupsFrom(
      client,
      [ownerOf(owned).cell],
      tip,
    );
    await vi.waitFor(() => {
      expect(calls).toEqual(["deposit", "request"]);
    });
    resolveRequest(transactionWithHeader(requestHeader));
    await Promise.resolve();
    resolveDeposit(depositHeader);

    const groups = await groupsPromise;

    expect(groups[0]?.owned.headers[0].header.number).toBe(depositHeader.number);
    expect(groups[0]?.owned.headers[1].header.number).toBe(requestHeader.number);
  });
});
