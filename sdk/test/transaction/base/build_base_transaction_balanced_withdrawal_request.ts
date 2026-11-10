import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderOrder } from "../../conversion/planning/support/sdk_order_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.buildBaseTransaction", () => {
  it("accepts withdrawal requests after balanced caller activity", () => {
    const { botLock, dao, logic, ownedOwnerManager, sdk } = baseTransactionFixture();
    const requestedDeposit = depositCell("85", logic, dao, baseTip, baseTip, {
      isReady: true,
    });
    const baseTx = ccc.Transaction.default();
    baseTx.inputs.push(
      ccc.CellInput.from({
        previousOutput: {
          txHash: hash("80"),
          index: 0n,
        },
      }),
    );
    baseTx.outputs.push(
      ccc.CellOutput.from({
        capacity: 1n,
        lock: botLock,
      }),
    );
    baseTx.outputsData.push("0x");

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(1);
      expect(tx.outputs).toHaveLength(1);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("81"),
            index: 0n,
          },
        }),
      );
      tx.outputs.push(
        ccc.CellOutput.from({
          capacity: 2n,
          lock: botLock,
        }),
      );
      tx.outputsData.push("0x");
      return tx;
    });

    const tx = sdk.buildBaseTransaction(
      baseTx,
      { availableOrders: [placeholderOrder], receipts: [], readyWithdrawals: [] },
      { deposits: [requestedDeposit], lock: botLock },
    );

    // The melt spends the order and its master after the caller's and the request's inputs.
    expect(tx.inputs.map(({ previousOutput }) => previousOutput.toHex())).toEqual([
      ccc.OutPoint.from({ txHash: hash("80"), index: 0n }).toHex(),
      ccc.OutPoint.from({ txHash: hash("81"), index: 0n }).toHex(),
      placeholderOrder.order.cell.outPoint.toHex(),
      placeholderOrder.master.cell.outPoint.toHex(),
    ]);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputsData).toEqual(["0x", "0x"]);
  });
});
