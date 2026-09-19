import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { LogicManager } from "../../../src/logic.ts";
import { encodeReceiptData } from "../../../src/udt.ts";

import { OrderManager } from "../../../src/order/order.ts";
import { encodeOwnerData, OwnedOwnerManager } from "../../../src/owned_owner.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  L1_STATE_SUITE,
  tipHeaderHandler,
  transactionWithHeader,
} from "./support/sdk_l1_support.ts";

const CKB = ccc.fixedPointFrom(1);

describe(L1_STATE_SUITE, () => {
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
    const cellsByLock = new Map([
      [
        accountLock.hash(),
        [plain, dataCell, nativeUdt, udtPrefixExtension, receipt, owner, pendingOwner],
      ],
    ]);
    const headersByNumber = new Map([
      [1n, headerLike(1n)],
      [5n, headerLike(5n, { epoch: ccc.Epoch.from([399n, 0n, 1n]) })],
    ]);
    const withdrawalHeaders = new Map([
      [hash("86"), headerLike(2n, { epoch: ccc.Epoch.from([2n, 0n, 1n]) })],
      [hash("88"), headerLike(6n, { epoch: ccc.Epoch.from([399n, 1n, 2n]) })],
    ]);
    const scans: ccc.ClientIndexerSearchKey[] = [];
    const tip = headerLike(1000n, { epoch: ccc.Epoch.from([400n, 0n, 1n]) });
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(tip),
      findCellsPagedNoCache: async (
        keyLike,
      ): ReturnType<ccc.Client["findCellsPagedNoCache"]> => {
        await Promise.resolve();
        const key = ccc.ClientIndexerSearchKey.from(keyLike);
        scans.push(key);
        return {
          cells: cellsByLock.get(ccc.Script.from(key.script).hash()) ?? [],
          lastCursor: "end",
        };
      },
      getCell: async (outPoint): ReturnType<ccc.Client["getCell"]> => {
        await Promise.resolve();
        return ccc.OutPoint.from(outPoint).txHash === hash("86") ? owned : pendingOwned;
      },
      getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
        await Promise.resolve();
        return headersByNumber.get(ccc.numFrom(number));
      },
      getTransactionWithHeader: async (
        txHash,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        await Promise.resolve();
        // Withdrawal headers are keyed by transaction; the receipt takes the first one.
        return transactionWithHeader(
          withdrawalHeaders.get(ccc.hexFrom(txHash)) ?? headerLike(2n),
        );
      },
    });

    const { system, account } = await sdk.getL1AccountState(client, [
      accountLock,
      accountLock,
    ]);

    // One scan per distinct lock, exact and unfiltered; the other three are public.
    const lockScans = scans.filter((key) => key.script.eq(accountLock));
    expect(lockScans).toHaveLength(1);
    expect(lockScans[0]).toMatchObject({
      scriptType: "lock",
      scriptSearchMode: "exact",
      withData: true,
    });
    expect(lockScans[0]?.filter).toBeUndefined();
    expect(scans).toHaveLength(4);

    expect(account.capacityCells).toEqual([plain]);
    expect(account.nativeUdtCells).toEqual([nativeUdt]);
    expect(account.receipts.map((found) => found.cell)).toEqual([receipt]);
    expect(account.withdrawalGroups.map((group) => group.owner.cell)).toEqual([
      owner,
      pendingOwner,
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
