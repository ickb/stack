import { ccc } from "@ckb-ccc/core";
import { LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function* once<T>(value: T): AsyncGenerator<T> {
  yield value;
  await Promise.resolve();
}

describe("IckbSdk.getAccountState", () => {
  it("collects account cells, receipts, withdrawals, and native iCKB balance", async () => {
    const accountLock = script("11");
    const udt = script("66");
    const receipt = receiptValue(13n, 17n, "22");
    const withdrawal = withdrawalValue({
      ckbValue: 19n,
      isReady: true,
      byte: "38",
    });
    const udtCell = ccc.Cell.from({
      outPoint: { txHash: hash("90"), index: 0n },
      cellOutput: { capacity: 7n, lock: accountLock, type: udt },
      outputData: ccc.numLeToBytes(11n, 16),
    });
    const capacityCell = ccc.Cell.from({
      outPoint: { txHash: hash("91"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const daoManager = new DaoManager(script("33"), []);
    const logicManager = new LogicManager(script("22"), [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(script("44"), [], daoManager);
    const ickbUdt = fakeIckbUdt(udt);
    vi.spyOn(logicManager, "findReceipts").mockImplementation(() => once(receipt));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() =>
      once(withdrawal),
    );
    const sdk = new IckbSdk(
      ickbUdt,
      ownedOwnerManager,
      logicManager,
      new OrderManager(script("55"), [], udt),
      [],
    );
    const client = new StubClient({
      async *findCellsOnChain(): ReturnType<ccc.Client["findCellsOnChain"]> {
        yield capacityCell;
        yield udtCell;
        await Promise.resolve();
      },
    });

    const state = await sdk.getAccountState(client, [accountLock, accountLock], baseTip);

    expect(state.capacityCells).toEqual([capacityCell]);
    expect(state.nativeUdtCells).toEqual([udtCell]);
    expect(state.nativeUdtCapacity).toBe(udtCell.cellOutput.capacity);
    expect(state.nativeUdtBalance).toBe(11n);
    expect(state.receipts).toEqual([receipt]);
    expect(state.withdrawalGroups).toEqual([withdrawal]);
  });
});
