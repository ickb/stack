import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogicManager, OwnedOwnerManager } from "../../../src/core/index.ts";
import { DaoManager } from "../../../src/dao/index.ts";
import { OrderManager } from "../../../src/order/index.ts";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  L1_STATE_SUITE,
  tipHeaderHandler,
  transactionWithHeader,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("counts plain bot cells, ignores bot data cells, and scans direct deposits", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const sdk = new IckbSdk({
      ickbUdt: fakeIckbUdt(udt),
      ownedOwner: new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
      ickbLogic: new LogicManager(logic, [], new DaoManager(dao, [])),
      order: new OrderManager(order, [], udt),
      bots: [botLock],
    });
    const fakeAlignedData = ccc.hexFrom(new Uint8Array(128).fill(0xaa));
    const header = headerLike(1n);
    const botCells = [
      ccc.Cell.from({
        outPoint: { txHash: hash("01"), index: 0n },
        cellOutput: { capacity: 1000n, lock: botLock },
        outputData: fakeAlignedData,
      }),
      ccc.Cell.from({
        outPoint: { txHash: hash("03"), index: 0n },
        cellOutput: { capacity: ccc.fixedPointFrom(5000), lock: botLock },
        outputData: "0x",
      }),
    ];
    const depositCell = ccc.Cell.from({
      outPoint: { txHash: hash("02"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: logic,
        type: dao,
      },
      outputData: DaoManager.depositData(),
    });
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(header),
      async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
        if (query.filter?.outputData === DaoManager.depositData()) {
          yield depositCell;
        }
        if (query.scriptType === "lock") {
          for (const cell of botCells) {
            yield cell;
          }
        }
        await Promise.resolve();
      },
      getTransactionWithHeader: async (
        txHash: ccc.Hex,
      ): ReturnType<ccc.Client["getTransactionWithHeader"]> => {
        await Promise.resolve();
        return transactionWithHeader(
          txHash === hash("02")
            ? headerLike(0n)
            : headerLike(1n, { epoch: ccc.Epoch.from([2n, 0n, 1n]) }),
        );
      },
    });

    const state = await sdk.getL1AccountState(client, []);

    expect(state.user.orders).toEqual([]);
    // The plain bot cell counts net of the 2,000 CKB the bot keeps; the data cell is ignored.
    expect(state.system.ckbAvailable).toBe(ccc.fixedPointFrom(3000));
    expect(state.system.ckbMaturing).toHaveLength(1);
    expect(state.system.ckbMaturing[0]?.ckbCumulative).toBe(ccc.fixedPointFrom(100082));
  });
});
