import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNED_OWNER } from "../../../src/constants.ts";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderOrder } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  depositCell,
  placeholderReceipt,
  placeholderWithdrawal,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function cellInput(byte: string): ccc.CellInput {
  return ccc.CellInput.from({
    previousOutput: {
      txHash: hash(byte),
      index: 0n,
    },
  });
}

describe("IckbSdk.buildBaseTransaction", () => {
  it("requests withdrawals before input-only base activity", () => {
    const { botLock, dao, logic, logicManager, sdk } = baseTransactionFixture();
    const requestedDeposit = depositCell("80", logic, dao, baseTip, baseTip, {
      isReady: true,
    });
    vi.spyOn(logicManager, "completeDeposit").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      tx.inputs.push(cellInput("72"));
      return tx;
    });

    const tx = sdk.buildBaseTransaction(
      ccc.Transaction.default(),
      {
        availableOrders: [placeholderOrder],
        receipts: [placeholderReceipt],
        readyWithdrawals: [placeholderWithdrawal],
      },
      { deposits: [requestedDeposit], lock: botLock },
    );

    // The request spends the deposit first, then the melt takes the order and its master,
    // the receipts follow, and the ready withdrawal and its owner come last.
    expect(tx.inputs.map(({ previousOutput }) => previousOutput.toHex())).toEqual([
      requestedDeposit.cell.outPoint.toHex(),
      placeholderOrder.order.cell.outPoint.toHex(),
      placeholderOrder.master.cell.outPoint.toHex(),
      cellInput("72").previousOutput.toHex(),
      placeholderWithdrawal.owned.cell.outPoint.toHex(),
      placeholderWithdrawal.owner.cell.outPoint.toHex(),
    ]);
    // Only the request adds outputs: the request at the deposit's index, then its marker.
    expect(tx.outputs.map(({ lock }) => lock)).toEqual([OWNED_OWNER, botLock]);
  });
});
