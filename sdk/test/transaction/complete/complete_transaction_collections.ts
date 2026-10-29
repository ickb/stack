import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
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
});
