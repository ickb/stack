import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBaseTransaction } from "../../../src/build.ts";
import { OWNED_OWNER } from "../../../src/constants.ts";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderOrder } from "../../conversion/planning/support/sdk_order_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildBaseTransaction", () => {
  it("accepts withdrawal requests after balanced caller activity", () => {
    const { botLock, dao, logic } = baseTransactionFixture();
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

    const tx = buildBaseTransaction(
      baseTx,
      { availableOrders: [placeholderOrder], receipts: [], readyWithdrawals: [] },
      { deposits: [requestedDeposit], lock: botLock },
    );

    // The melt spends the order and its master after the caller's and the request's inputs.
    expect(tx.inputs.map(({ previousOutput }) => previousOutput.toHex())).toEqual([
      ccc.OutPoint.from({ txHash: hash("80"), index: 0n }).toHex(),
      requestedDeposit.cell.outPoint.toHex(),
      placeholderOrder.order.cell.outPoint.toHex(),
      placeholderOrder.master.cell.outPoint.toHex(),
    ]);
    // The request pairs with the deposit at its own index, after the caller's output.
    expect(tx.outputs.map(({ lock }) => lock)).toEqual([botLock, OWNED_OWNER, botLock]);
    expect(tx.outputs[2]?.type?.eq(OWNED_OWNER)).toBe(true);
  });
});
