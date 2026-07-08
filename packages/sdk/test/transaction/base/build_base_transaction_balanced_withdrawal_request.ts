import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseTransactionFixture,
  BUILD_BASE_TRANSACTION_SUITE,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderOrder } from "../../conversion/planning/support/sdk_order_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseClient, baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(BUILD_BASE_TRANSACTION_SUITE, () => {
  it("accepts withdrawal requests after balanced caller activity", async () => {
    const { botLock, dao, logic, orderManager, ownedOwnerManager, sdk } =
      baseTransactionFixture();
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

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
      async (txLike) => {
        await Promise.resolve();
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
      },
    );
    vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      expect(tx.inputs).toHaveLength(2);
      expect(tx.outputs).toHaveLength(2);
      tx.inputs.push(
        ccc.CellInput.from({
          previousOutput: {
            txHash: hash("82"),
            index: 0n,
          },
        }),
      );
      return tx;
    });

    const tx = await sdk.buildBaseTransaction(baseTx, baseClient, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        lock: botLock,
      },
      orders: [placeholderOrder],
    });

    expect(tx.inputs).toHaveLength(3);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputsData).toEqual(["0x", "0x"]);
  });
});
