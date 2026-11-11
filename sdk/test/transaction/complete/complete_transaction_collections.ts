import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { completeTransaction } from "../../../src/complete.ts";
import {
  baseTransactionFixture,
  fundedSigner,
  mustComplete,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { readyWithdrawalGroup } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, headerLike, state } from "../base/support/sdk_core_support.ts";

// A collection input funds the fee and the change
// on its own, so an account with no plain cell still completes its collections.
describe("completeTransaction with collections", () => {
  it("completes a withdrawal collection with zero plain cells", async () => {
    const { botLock, sdk } = baseTransactionFixture();
    const group = readyWithdrawalGroup({
      ownerLock: botLock,
      depositHeader: headerLike(10n),
      withdrawalHeader: headerLike(12n),
    });
    const { signer } = fundedSigner([], [botLock], [group]);
    const feeRate = 1000n;
    const tx = sdk.buildBaseTransaction(ccc.Transaction.default(), {
      availableOrders: [],
      receipts: [],
      readyWithdrawals: [group],
    });
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(0);

    const { tx: completed, plannedFee } = mustComplete(
      await completeTransaction(tx, {
        signer,
        state: state({ feeRate }),
      }),
    );

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputs).toHaveLength(1);
    const collected =
      group.owned.cell.cellOutput.capacity + group.owner.cell.cellOutput.capacity;
    const change = completed.outputs[0]?.capacity ?? 0n;
    expect(plannedFee).toBe(completed.estimateFee(feeRate));
    expect(collected - change).toBe(plannedFee);
    // The deposit header leads, as dao.c reads one byte of its index; the priced tip trails.
    expect(completed.headerDeps).toEqual([
      group.owned.headers[0].hash,
      group.owned.headers[1].hash,
      baseTip.hash,
    ]);
  });
});
