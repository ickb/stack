import { ccc } from "@ckb-ccc/core";
import { capacityCell } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  baseTransactionFixture,
  fundedSigner,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { readyWithdrawalGroup } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, headerLike } from "../base/support/sdk_core_support.ts";

// Adopted from the fable51 policy audit: a collection input funds the fee and the change
// on its own, so an account with no plain cell still completes its collections.
describe("completeTransaction with collections", () => {
  it("completes a withdrawal collection with zero plain cells", async () => {
    const { botLock, dao, ownedOwner, sdk } = baseTransactionFixture({
      completion: "real",
    });
    const group = readyWithdrawalGroup({
      ownerLock: botLock,
      ownedOwner,
      dao,
      depositHeader: headerLike(10n),
      withdrawalHeader: headerLike(12n),
    });
    const { signer } = fundedSigner([], [botLock]);
    const feeRate = 1000n;
    const tx = sdk.buildBaseTransaction(ccc.Transaction.default(), {
      availableOrders: [],
      receipts: [],
      readyWithdrawals: [group],
    });
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(0);

    const completed = await sdk.completeTransaction(tx, {
      signer,
      feeRate,
      cells: [],
      protocolCells: [],
      tip: baseTip,
    });

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputs).toHaveLength(1);
    const collected =
      group.owned.cell.cellOutput.capacity + group.owner.cell.cellOutput.capacity;
    const change = completed.outputs[0]?.capacity ?? 0n;
    expect(collected - change).toBe(completed.estimateFee(feeRate));
    // The deposit header leads, as dao.c reads one byte of its index; the priced tip trails.
    expect(completed.headerDeps).toEqual([
      group.owned.headers[0].hash,
      group.owned.headers[1].hash,
      baseTip.hash,
    ]);
  });
  it("refuses a completion that a verified re-read prices higher", async () => {
    const { botLock, sdk } = baseTransactionFixture({ completion: "real" });
    const { signer, cells } = fundedSigner(
      [capacityCell(ccc.fixedPointFrom(1000), botLock, "71")],
      [botLock],
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with each transaction as `this` below.
    const getFee = ccc.Transaction.prototype.getFee;
    // A node answers the verified re-read differently from CCC's own read: one shannon more.
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockImplementation(async function (
      this: ccc.Transaction,
      client: ccc.Client,
    ): Promise<ccc.Num> {
      const fee = await getFee.call(this, client);
      return ccc.Proxy.inner in client ? fee + 1n : fee;
    });

    await expect(
      sdk.completeTransaction(ccc.Transaction.default(), {
        signer,
        feeRate: 1000n,
        cells,
        protocolCells: [],
        tip: baseTip,
      }),
    ).rejects.toThrow("Completion priced the fee below what the chain would take");
  });
});
