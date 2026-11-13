import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, headerLike, script, StubClient } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import { DAO, ICKB_LOGIC, OWNED_OWNER } from "../../src/constants.ts";
import { DAO_DEPOSIT_DATA, DAO_HEADER_INDEX_LIMIT } from "../../src/dao.ts";
import type { DepositCell } from "../../src/logic.ts";
import {
  decodeOwnerData,
  encodeOwnerData,
  isOwned,
  isOwner,
  OwnerCell,
  requestWithdrawal,
  withdraw,
  WithdrawalGroup,
  withdrawalGroupsFrom,
  withdrawalRequestCell,
  type DaoWithdrawalRequestCell,
} from "../../src/owned_owner.ts";
import { ickbValue } from "../../src/udt.ts";

const userLock = script("44");
// Typed unknown so the matcher's `any` stays out of the asserted object.
const anyError: unknown = expect.any(Error);

function depositOf(txHashByte: string, header = headerLike({ number: 1n })): DepositCell {
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: ICKB_LOGIC, type: DAO },
    outputData: DAO_DEPOSIT_DATA,
  });
  return {
    cell,
    header,
    claimEpoch: ccc.Epoch.from([1n, 0n, 1n]),
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
      lock: OWNED_OWNER,
      type: DAO,
    },
    outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
  });
  return {
    cell,
    depositHeader,
    requestHeader,
    claimEpoch: ccc.Epoch.from([180n, 0n, 1n]),
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
      cellOutput: { capacity: 61n, lock: userLock, type: OWNED_OWNER },
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
  });

  it("rejects owner markers that point before output zero", () => {
    const owner = new OwnerCell(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("12"), index: 0n },
        cellOutput: { capacity: 61n, lock: userLock, type: OWNED_OWNER },
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
        cellOutput: { capacity: 61n, lock: userLock, type: OWNED_OWNER },
        outputData: "0x12",
      }),
    );

    expect(() => owner.getOwned()).toThrow(
      expect.objectContaining({
        message: `Invalid owner marker payload at ${owner.cell.outPoint.toHex()}: 0x12`,
        cause: anyError,
      }),
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

describe("owned owner cell shapes", () => {
  it("recognizes owner markers by type and decodable data, and owned requests by lock", () => {
    const owned = requestOf(headerLike({ number: 1n }), headerLike({ number: 2n }));
    const owner = ownerOf(owned);
    const undecodable = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("12"), index: 0n },
      cellOutput: { capacity: 61n, lock: userLock, type: OWNED_OWNER },
      outputData: "0xffffffff",
    });
    const short = ccc.Cell.from({
      outPoint: undecodable.outPoint,
      cellOutput: undecodable.cellOutput,
      outputData: "0x123456",
    });
    const foreignLock = cellWith(owned.cell, { lock: userLock });

    expect(isOwner(owner.cell)).toBe(true);
    expect(isOwner(undecodable)).toBe(false);
    expect(isOwner(short)).toBe(false);
    expect(isOwner(owned.cell)).toBe(false);
    expect(isOwned(owned.cell)).toBe(true);
    expect(isOwned(foreignLock)).toBe(false);
  });
});

describe("requestWithdrawal", () => {
  it("leaves the transaction unchanged when no deposits are given", () => {
    // Transaction.from returns the instance it is given, so compare with a fresh one.
    expect(requestWithdrawal(ccc.Transaction.default(), [], userLock)).toEqual(
      ccc.Transaction.default(),
    );
  });

  it("spends each deposit into a request and an owner marker pointing back at it", () => {
    const deposits = [
      depositOf("66"),
      depositOf("77", headerLike({ number: 2n, hash: byte32FromByte("cc") })),
    ];

    const tx = requestWithdrawal(ccc.Transaction.default(), deposits, userLock);

    // Completion, not the builder, adds the iCKB dep group.
    expect(tx.cellDeps).toEqual([]);
    expect(tx.headerDeps).toEqual(deposits.map((deposit) => deposit.header.hash));
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual(
      deposits.map((deposit) => deposit.cell.outPoint.toHex()),
    );
    expect(tx.outputs).toHaveLength(4);
    expect(tx.outputs[0]?.lock.eq(OWNED_OWNER)).toBe(true);
    expect(tx.outputs[0]?.type?.eq(DAO)).toBe(true);
    expect(tx.outputsData[1]).toBe(ccc.hexFrom(ccc.mol.Uint64LE.encode(2n)));
    expect(tx.outputs[2]?.lock.eq(userLock)).toBe(true);
    expect(tx.outputs[2]?.type?.eq(OWNED_OWNER)).toBe(true);
    expect(decodeOwnerData(tx.outputsData[2] ?? "0x").ownedDistance).toBe(-2n);
    expect(decodeOwnerData(tx.outputsData[3] ?? "0x").ownedDistance).toBe(-2n);
  });

  it("does not duplicate an existing deposit header dep", () => {
    const deposit = depositOf("66");
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(deposit.header.hash);

    expect(requestWithdrawal(tx, [deposit], userLock).headerDeps).toEqual([
      deposit.header.hash,
    ]);
  });

  it("requires matched input and output counts before appending requests", () => {
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock: userLock }, "0x");

    expect(() => requestWithdrawal(tx, [depositOf("66")], userLock)).toThrow(
      "Transaction has different inputs and outputs lengths",
    );
    const strayData = ccc.Transaction.default();
    strayData.outputsData.push("0xab");
    expect(() => requestWithdrawal(strayData, [depositOf("66")], userLock)).toThrow(
      "Transaction has different inputs and outputs lengths",
    );
  });

  it("rejects a deposit whose lock args differ in size from the request lock", () => {
    const deposit = depositOf("66");
    deposit.cell.cellOutput.lock = script("22", "0x12");

    expect(() =>
      requestWithdrawal(ccc.Transaction.default(), [deposit], userLock),
    ).toThrow("Withdrawal request lock args has different size from deposit");
  });
});

describe("withdraw", () => {
  const depositHeader = headerLike({ number: 1n, hash: byte32FromByte("a1") });
  const requestHeader = headerLike({ number: 2n, hash: byte32FromByte("b1") });

  it("leaves the transaction unchanged when no groups are given", () => {
    expect(withdraw(ccc.Transaction.default(), [])).toEqual(ccc.Transaction.default());
  });

  it("writes since, header deps, witness input types, then the owner inputs", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const owner = ownerOf(owned);

    const tx = withdraw(ccc.Transaction.default(), [new WithdrawalGroup(owned, owner)]);

    // Completion, not the builder, adds the iCKB dep group.
    expect(tx.cellDeps).toEqual([]);
    expect(tx.headerDeps).toEqual([depositHeader.hash, requestHeader.hash]);
    expect(tx.inputs.map((input) => input.previousOutput.toHex())).toEqual([
      owned.cell.outPoint.toHex(),
      owner.cell.outPoint.toHex(),
    ]);
    const since = tx.inputs[0]?.since;
    if (since === undefined) {
      throw new Error("Expected withdrawal input since");
    }
    expect(ccc.Since.from(since).relative).toBe("absolute");
    expect(ccc.Since.from(since).metric).toBe("epoch");
    expect(ccc.Since.from(since).value).toBe(owned.claimEpoch.toNum());
    expect(tx.getWitnessArgs(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
  });

  it("pushes every deposit header before any withdrawal header", () => {
    const first = requestOf(depositHeader, requestHeader, "55");
    const second = requestOf(
      headerLike({ number: 3n, hash: byte32FromByte("a2") }),
      headerLike({ number: 4n, hash: byte32FromByte("b2") }),
      "56",
    );

    const tx = withdraw(ccc.Transaction.default(), [
      new WithdrawalGroup(first, ownerOf(first)),
      new WithdrawalGroup(second, ownerOf(second)),
    ]);

    expect(tx.headerDeps).toEqual([
      first.depositHeader.hash,
      second.depositHeader.hash,
      first.requestHeader.hash,
      second.requestHeader.hash,
    ]);
    expect(tx.getWitnessArgs(0)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(0n, 8)));
    expect(tx.getWitnessArgs(1)?.inputType).toBe(ccc.hexFrom(ccc.numLeToBytes(1n, 8)));
  });

  it("does not duplicate existing header deps", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    tx.headerDeps.push(depositHeader.hash, requestHeader.hash);

    const updated = withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]);

    expect(updated.headerDeps).toEqual([depositHeader.hash, requestHeader.hash]);
  });

  it("moves the deposit headers ahead of every header already present", () => {
    // Only phase 2 names a header by index, so the others may shift.
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    for (let index = 0; index < DAO_HEADER_INDEX_LIMIT; index += 1) {
      tx.headerDeps.push(ccc.hexFrom(ccc.numToBytes(index + 1, 32)));
    }
    tx.headerDeps.push(depositHeader.hash);

    const updated = withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]);

    expect(updated.headerDeps[0]).toBe(depositHeader.hash);
    expect(updated.headerDeps).toHaveLength(DAO_HEADER_INDEX_LIMIT + 2);
    expect(updated.getWitnessArgs(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
  });

  it("preserves an existing non-input witness by shifting it after the new input", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const tx = ccc.Transaction.default();
    const preservedWitness = ccc.WitnessArgs.from({ inputType: "0xab" }).toHex();
    tx.witnesses.push(preservedWitness);

    const updated = withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))]);

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

    expect(() => withdraw(tx, [new WithdrawalGroup(owned, ownerOf(owned))])).toThrow(
      "Witnesses of withdrawal request already in use",
    );
  });

  it("rejects a group whose owner points at a different owned cell", () => {
    const owned = requestOf(depositHeader, requestHeader);
    const other = requestOf(depositHeader, requestHeader, "56");

    expect(() =>
      withdraw(ccc.Transaction.default(), [new WithdrawalGroup(owned, ownerOf(other))]),
    ).toThrow("but group owned cell is");
  });
});

describe("withdrawalRequestCell", () => {
  const withdrawalCell = ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: OWNED_OWNER,
      type: DAO,
    },
    outputData: ccc.mol.Uint64LE.encode(1n),
  });

  it("marks requests ready once the claim epoch is reached", () => {
    const depositHeader = headerLike({
      epoch: [1n, 0n, 1n],
      number: 1n,
      dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
    });
    const requestHeader = headerLike({
      epoch: [180n, 0n, 1n],
      number: 2n,
      dao: { c: 0n, ar: 11000000000000000n, s: 0n, u: 0n },
    });
    const tip = headerLike({ epoch: [181n, 0n, 1n], number: 3n });

    const cell = withdrawalRequestCell(withdrawalCell, depositHeader, requestHeader, tip);

    expect(cell.claimEpoch.eq(ccc.calcDaoClaimEpoch(depositHeader, requestHeader))).toBe(
      true,
    );
    expect(cell.isReady).toBe(true);
    // The accumulated rate grew 10%, so does the free capacity.
    expect(cell.ckbValue).toBe(
      withdrawalCell.cellOutput.capacity + withdrawalCell.capacityFree / 10n,
    );
  });

  it("keeps requests pending before the claim epoch", () => {
    const depositHeader = headerLike({ epoch: [1n, 0n, 1n], number: 1n });
    const requestHeader = headerLike({ epoch: [180n, 0n, 1n], number: 2n });
    const tip = headerLike({ epoch: [179n, 0n, 1n], number: 3n });

    expect(
      withdrawalRequestCell(withdrawalCell, depositHeader, requestHeader, tip).isReady,
    ).toBe(false);
  });

  it("does not add another cycle at an equal fractional epoch", () => {
    const depositHeader = headerLike({ epoch: [1n, 1n, 2n], number: 1n });
    const requestHeader = headerLike({ epoch: [181n, 1n, 2n], number: 2n });
    const tip = headerLike({ epoch: [181n, 1n, 2n], number: 3n });

    const cell = withdrawalRequestCell(withdrawalCell, depositHeader, requestHeader, tip);

    expect(cell.claimEpoch.eq([181n, 1n, 2n])).toBe(true);
    expect(cell.isReady).toBe(true);
  });
});

describe("withdrawalGroupsFrom", () => {
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
      getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        const kind = ccc.numFrom(number) === depositHeader.number ? "deposit" : "request";
        calls.push(kind);
        await Promise.resolve();
        if (missing === kind) {
          return undefined;
        }
        return kind === "deposit" ? depositHeader : requestHeader;
      },
    });
    return { client, calls };
  }

  /** An owner marker as the account scan returns it, in its request's block. */
  function scanned(owner: { cell: ccc.Cell }): { cell: ccc.Cell; blockNumber: ccc.Num } {
    return { cell: owner.cell, blockNumber: requestHeader.number };
  }

  it("pairs each owner marker with its owned request and its two headers", async () => {
    const first = requestOf(depositHeader, requestHeader, "55");
    const second = requestOf(depositHeader, requestHeader, "55");
    Object.assign(second.cell.outPoint, { index: 2n });
    const owners = [ownerOf(first), ownerOf(second)];
    const { client, calls } = clientFor(
      new Map(
        [first, second].map((request) => [request.cell.outPoint.toHex(), request.cell]),
      ),
    );

    const groups = await withdrawalGroupsFrom(client, owners.map(scanned), tip);

    // Each group asks for both; the verified client the state read passes shares a block's.
    expect(calls).toEqual(["deposit", "request", "deposit", "request"]);
    expect(groups.map((group) => group.owner.cell.outPoint.toHex())).toEqual(
      owners.map((owner) => owner.cell.outPoint.toHex()),
    );
    expect(groups[0]?.owned).toMatchObject({ isReady: true });
    expect(groups[0]?.owned.requestHeader).toBe(requestHeader);
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
      outputData: DAO_DEPOSIT_DATA,
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

    const groups = await withdrawalGroupsFrom(client, owners.map(scanned), tip);

    expect(groups.map((group) => group.owned.cell.outPoint.toHex())).toEqual([
      owned.cell.outPoint.toHex(),
    ]);
  });

  it("rejects an owned request whose payload cannot be decoded", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    owned.cell.outputData = "0x12";
    const { client } = clientFor(new Map([[owned.cell.outPoint.toHex(), owned.cell]]));

    await expect(
      withdrawalGroupsFrom(client, [scanned(ownerOf(owned))], tip),
    ).rejects.toThrow(
      expect.objectContaining({
        message: `Invalid DAO withdrawal request payload at ${owned.cell.outPoint.toHex()}: 0x12`,
        cause: anyError,
      }),
    );
  });

  it("rejects a batch whose headers are unavailable", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    const cells = new Map([[owned.cell.outPoint.toHex(), owned.cell]]);
    const missingRequest = clientFor(cells, "request").client;
    const missingDeposit = clientFor(cells, "deposit").client;

    await expect(
      withdrawalGroupsFrom(missingRequest, [scanned(ownerOf(owned))], tip),
    ).rejects.toThrow("Header not found for block number 2");
    await expect(
      withdrawalGroupsFrom(missingDeposit, [scanned(ownerOf(owned))], tip),
    ).rejects.toThrow("Header not found for block number 1");
  });

  it("reads the deposit and request headers concurrently", async () => {
    const owned = requestOf(depositHeader, requestHeader, "55");
    const calls: ccc.Num[] = [];
    const fetches = new Map(
      [depositHeader, requestHeader].map((header) => [
        header.number,
        Promise.withResolvers<ccc.ClientBlockHeader>(),
      ]),
    );
    const client = new StubClient({
      getCell: async (): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return owned.cell;
      },
      getHeaderByNumber: async (number): Promise<ccc.ClientBlockHeader> => {
        const asked = ccc.numFrom(number);
        calls.push(asked);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- only the two blocks are asked.
        return fetches.get(asked)!.promise;
      },
    });

    const groupsPromise = withdrawalGroupsFrom(client, [scanned(ownerOf(owned))], tip);
    await vi.waitFor(() => {
      expect(calls).toEqual([depositHeader.number, requestHeader.number]);
    });
    fetches.get(requestHeader.number)?.resolve(requestHeader);
    await Promise.resolve();
    fetches.get(depositHeader.number)?.resolve(depositHeader);

    const groups = await groupsPromise;

    expect(groups[0]?.owned.depositHeader.number).toBe(depositHeader.number);
    expect(groups[0]?.owned.requestHeader.number).toBe(requestHeader.number);
  });
});
