import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseTransactionFixture,
  BUILD_BASE_TRANSACTION_SUITE,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const NO_COLLECT = { availableOrders: [], receipts: [], readyWithdrawals: [] };

describe(BUILD_BASE_TRANSACTION_SUITE, () => {
  it("lets callers append a deposit after the withdrawal request path", () => {
    const { botLock, dao, logic, logicManager, ownedOwnerManager, sdk } =
      baseTransactionFixture();
    const calls: string[] = [];
    const requestedDeposit = depositCell("85", logic, dao, baseTip, baseTip, {
      isReady: true,
    });

    vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation((txLike) => {
      calls.push("request");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.outputs).toHaveLength(0);
      tx.outputs.push(
        ccc.CellOutput.from({
          capacity: 1n,
          lock: botLock,
        }),
      );
      tx.outputsData.push("0x");
      return tx;
    });
    vi.spyOn(logicManager, "deposit").mockImplementation((txLike) => {
      calls.push("deposit");
      const tx = ccc.Transaction.from(txLike);
      expect(tx.outputs).toHaveLength(1);
      tx.outputs.push(
        ccc.CellOutput.from({
          capacity: 2n,
          lock: botLock,
        }),
      );
      tx.outputsData.push("0x");
      return tx;
    });

    let tx = sdk.buildBaseTransaction(ccc.Transaction.default(), NO_COLLECT, {
      deposits: [requestedDeposit],
      lock: botLock,
    });
    tx = logicManager.deposit(tx, 1, 2n, botLock);

    expect(calls).toEqual(["request", "deposit"]);
    expect(tx.outputs).toHaveLength(2);
  });

  it("lets DAO withdrawal own unbalanced caller prework rejection", () => {
    const { botLock, dao, logic, sdk } = baseTransactionFixture();
    const tx = ccc.Transaction.default();
    tx.inputs.push(
      ccc.CellInput.from({
        previousOutput: {
          txHash: hash("84"),
          index: 0n,
        },
      }),
    );

    expect(() =>
      sdk.buildBaseTransaction(tx, NO_COLLECT, {
        deposits: [depositCell("85", logic, dao, baseTip, baseTip, { isReady: true })],
        lock: botLock,
      }),
    ).toThrow("Transaction has different inputs and outputs lengths");
  });
});
