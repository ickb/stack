import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { ReceiptData } from "../../../src/core/entities.ts";
import { DaoManager, LogicManager, OwnedOwnerManager } from "../../../src/core/index.ts";
import { OrderManager } from "../../../src/order/index.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  ownedWithdrawalCell,
  ownerMarkerCell,
} from "../../core/owned_owner/support/owned_owner_support.ts";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  L1_STATE_SUITE,
  tipHeaderHandler,
  transactionWithHeader,
} from "./support/sdk_l1_support.ts";

const CKB = ccc.fixedPointFrom(1);

describe(L1_STATE_SUITE, () => {
  it("reads each account and known-bot lock with one unfiltered exact scan and classifies it", async () => {
    const accountLock = script("11");
    const otherBot = script("12");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const udt = script("66");
    const sdk = new IckbSdk({
      ickbUdt: fakeIckbUdt(udt),
      ownedOwner: new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      ickbLogic: new LogicManager(logic, [], new DaoManager(dao, [])),
      order: new OrderManager(script("55"), [], udt),
      bots: [accountLock, otherBot],
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
      ReceiptData.from({ depositQuantity: 1, depositAmount: 100000n * CKB }).toBytes(),
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
    const otherBotPlain = cell("87", otherBot, 5000n * CKB);
    const cellsByLock = new Map([
      [
        accountLock.hash(),
        [plain, dataCell, nativeUdt, udtPrefixExtension, receipt, owner, pendingOwner],
      ],
      [otherBot.hash(), [otherBotPlain]],
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

    // One scan per distinct lock, each exact and unfiltered; the other three are public.
    for (const lock of [accountLock, otherBot]) {
      const lockScans = scans.filter((key) => key.script.eq(lock));
      expect(lockScans).toHaveLength(1);
      expect(lockScans[0]).toMatchObject({
        scriptType: "lock",
        scriptSearchMode: "exact",
        withData: true,
      });
      expect(lockScans[0]?.filter).toBeUndefined();
    }
    expect(scans).toHaveLength(5);

    expect(account.capacityCells).toEqual([plain]);
    expect(account.nativeUdtCells).toEqual([nativeUdt]);
    expect(account.receipts.map((found) => found.cell)).toEqual([receipt]);
    expect(account.withdrawalGroups.map((group) => group.owner.cell)).toEqual([
      owner,
      pendingOwner,
    ]);

    // The bot estimate is the bot's own projection net of the 1,000 CKB reserve: plain
    // CKB, the iCKB cell's capacity, the receipt, and the ready withdrawal; the other
    // bot's plain CKB counts too.
    const [withdrawal, pending] = account.withdrawalGroups;
    expect(withdrawal?.owned.isReady).toBe(true);
    expect(pending?.owned.isReady).toBe(false);
    expect(system.ckbAvailable).toBe(
      2000n * CKB +
        nativeUdt.cellOutput.capacity +
        (account.receipts[0]?.ckbValue ?? 0n) +
        (withdrawal?.ckbValue ?? 0n) +
        4000n * CKB,
    );
    expect(system.ckbMaturing).toEqual([
      { ckbCumulative: pending?.ckbValue, maturity: pending?.owned.maturity.toUnix(tip) },
    ]);
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
