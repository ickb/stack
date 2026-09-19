import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  baseTransactionFixture,
  fundedSigner,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { readyWithdrawalGroup } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { hash, headerLike } from "../base/support/sdk_core_support.ts";

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
      depositHeader: headerLike(10n, { hash: hash("a1") }),
      withdrawalHeader: headerLike(12n, { hash: hash("a3") }),
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

    const completed = await sdk.completeTransaction(tx, { signer, feeRate, cells: [] });

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputs).toHaveLength(1);
    const collected =
      group.owned.cell.cellOutput.capacity + group.owner.cell.cellOutput.capacity;
    const change = completed.outputs[0]?.capacity ?? 0n;
    expect(collected - change).toBe(completed.estimateFee(feeRate));
  });
});
