import { ccc } from "@ckb-ccc/core";
import type { cccA } from "@ckb-ccc/core/advanced";
import { committedTransactionResponse, script, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { encodeReceiptData, LogicManager } from "../../../src/logic.ts";

import { OrderManager } from "../../../src/order/order.ts";
import { encodeOwnerData, OwnedOwnerManager } from "../../../src/owned_owner.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { anchoredAt, FeeRateStubClient } from "./support/sdk_l1_support.ts";

const CKB = ccc.fixedPointFrom(1);

describe("IckbSdk.getL1AccountState", () => {
  it("reads each account lock with one unfiltered exact scan and classifies it", async () => {
    const accountLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const udt = script("66");
    const sdk = new IckbSdk({
      ickbUdt: fakeIckbUdt(udt),
      ownedOwner: new OwnedOwnerManager(ownedOwner, [], { script: dao, cellDeps: [] }),
      ickbLogic: new LogicManager(logic, [], { script: dao, cellDeps: [] }),
      order: new OrderManager(script("55"), [], udt),
    });
    const plain = cell("81", accountLock, 3000n * CKB);
    const dataCell = cell("82", accountLock, 100n * CKB, undefined, "0xaa");
    const nativeUdt = cell("83", accountLock, 100n * CKB, udt, ccc.numLeToBytes(7n, 16));
    const udtPrefixExtension = cell(
      "84",
      accountLock,
      100n * CKB,
      ccc.Script.from({
        codeHash: udt.codeHash,
        hashType: udt.hashType,
        args: `${udt.args}00`,
      }),
      ccc.numLeToBytes(9n, 16),
    );
    const receipt = cell(
      "85",
      accountLock,
      100082n * CKB,
      logic,
      encodeReceiptData({ depositQuantity: 1n, depositAmount: 100000n * CKB }),
    );
    const owner = ownerMarkerCell("86", 1n, accountLock, ownedOwner);
    const owned = ownedWithdrawalCell({
      txHashByte: "86",
      index: 0n,
      ownedOwnerScript: ownedOwner,
      daoScript: dao,
      depositHeaderNumber: 1n,
    });
    // A second withdrawal requested at the tip epoch is still maturing.
    const pendingOwner = ownerMarkerCell("88", 1n, accountLock, ownedOwner);
    const pendingOwned = ownedWithdrawalCell({
      txHashByte: "88",
      index: 0n,
      ownedOwnerScript: ownedOwner,
      daoScript: dao,
      depositHeaderNumber: 5n,
    });
    // Each request and its marker come from one real transaction body, which the SDK reads
    // the request from and checks against the outpoint's hash.
    const {
      owned: ownedCell,
      owner: ownerCell,
      tx: ownedTx,
    } = requestTransaction(owned, owner);
    const {
      owned: pendingOwnedCell,
      owner: pendingOwnerCell,
      tx: pendingTx,
    } = requestTransaction(pendingOwned, pendingOwner);
    // The account scan names each cell's block: the receipt's deposit block and each
    // marker's request block, where its owned withdrawal request was created beside it.
    const cellsByLock = new Map([
      [
        accountLock.hash(),
        [
          plain,
          dataCell,
          nativeUdt,
          udtPrefixExtension,
          { cell: receipt, blockNumber: 2n },
          { cell: ownerCell, blockNumber: 2n },
          { cell: pendingOwnerCell, blockNumber: 6n },
        ],
      ],
    ]);
    const headersByNumber = new Map([
      [1n, headerLike(1n)],
      [2n, headerLike(2n, { epoch: ccc.Epoch.from([2n, 0n, 1n]) })],
      [5n, headerLike(5n, { epoch: ccc.Epoch.from([399n, 0n, 1n]) })],
      [6n, headerLike(6n, { epoch: ccc.Epoch.from([399n, 1n, 2n]) })],
    ]);
    const scans: cccA.JsonRpcIndexerSearchKey[] = [];
    const tip = headerLike(1000n, {
      epoch: ccc.Epoch.from([400n, 0n, 1n]),
      timestamp: BigInt(Date.now()),
    });
    const client = new FeeRateStubClient({
      ...anchoredAt(tip, headersByNumber),
      cells: (key): readonly StubCell[] => {
        scans.push(key);
        const { code_hash: codeHash, hash_type: hashType, args } = key.script;
        return (
          cellsByLock.get(ccc.Script.from({ codeHash, hashType, args }).hash()) ?? []
        );
      },
      getTransaction: async (txHash): ReturnType<ccc.Client["getTransaction"]> => {
        await Promise.resolve();
        const body = [ownedTx, pendingTx].find((tx) => tx.hash() === ccc.hexFrom(txHash));
        return body === undefined ? undefined : committedTransactionResponse(body);
      },
    });

    const { system, account } = await sdk.getL1AccountState(
      client,
      [accountLock, accountLock],
      WALLET_LOCK_UP,
    );

    // One scan per distinct lock, exact and unfiltered; the other three are public.
    const lockScans = scans.filter(
      ({ script: { code_hash: codeHash, hash_type: hashType, args } }) =>
        ccc.Script.from({ codeHash, hashType, args }).eq(accountLock),
    );
    expect(lockScans).toHaveLength(1);
    expect(lockScans[0]).toMatchObject({
      script_type: "lock",
      script_search_mode: "exact",
      with_data: true,
    });
    expect(lockScans[0]?.filter).toBeUndefined();
    expect(scans).toHaveLength(4);

    expect(account.capacityCells).toEqual([plain]);
    expect(account.nativeUdtCells).toEqual([nativeUdt]);
    expect(account.receipts.map((found) => found.cell)).toEqual([receipt]);
    expect(account.withdrawalGroups.map((group) => group.owner.cell)).toEqual([
      ownerCell,
      pendingOwnerCell,
    ]);
    expect(account.withdrawalGroups.map((group) => group.owned.cell)).toEqual([
      ownedCell,
      pendingOwnedCell,
    ]);

    // Account cells never count as system liquidity: the pool is empty here.
    const [withdrawal, pending] = account.withdrawalGroups;
    expect(withdrawal?.owned.isReady).toBe(true);
    expect(pending?.owned.isReady).toBe(false);
    expect(system.poolDeposits).toEqual([]);
  });
});

function cell(
  byte: string,
  lock: ccc.Script,
  capacity: bigint,
  type?: ccc.Script,
  outputData: ccc.BytesLike = "0x",
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: { capacity, lock, type },
    outputData,
  });
}

function ownerMarkerCell(
  txHashByte: string,
  index: bigint,
  ownerLock: ccc.Script,
  ownedOwnerScript: ccc.Script,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(txHashByte), index },
    cellOutput: { capacity: 61n, lock: ownerLock, type: ownedOwnerScript },
    outputData: encodeOwnerData({ ownedDistance: -1n }),
  });
}

function ownedWithdrawalCell({
  txHashByte,
  index,
  ownedOwnerScript,
  daoScript,
  depositHeaderNumber,
}: {
  txHashByte: string;
  index: bigint;
  ownedOwnerScript: ccc.Script;
  daoScript: ccc.Script;
  depositHeaderNumber: bigint;
}): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(txHashByte), index },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: ownedOwnerScript,
      type: daoScript,
    },
    outputData: ccc.mol.Uint64LE.encode(depositHeaderNumber),
  });
}

/** A request and its owner marker as outputs 0 and 1 of one real transaction. */
function requestTransaction(
  owned: ccc.Cell,
  owner: ccc.Cell,
): { owned: ccc.Cell; owner: ccc.Cell; tx: ccc.Transaction } {
  const tx = ccc.Transaction.from({
    outputs: [owned.cellOutput, owner.cellOutput],
    outputsData: [owned.outputData, owner.outputData],
  });
  const at = ({ cellOutput, outputData }: ccc.Cell, index: bigint): ccc.Cell =>
    ccc.Cell.from({ outPoint: { txHash: tx.hash(), index }, cellOutput, outputData });
  return { owned: at(owned, 0n), owner: at(owner, 1n), tx };
}
