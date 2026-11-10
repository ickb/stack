import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OWNED_OWNER } from "../../../src/constants.ts";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const NO_COLLECT = { availableOrders: [], receipts: [], readyWithdrawals: [] };

describe("IckbSdk.buildBaseTransaction", () => {
  it("lets callers append a deposit after the withdrawal request path", () => {
    const { botLock, dao, logic, logicManager, sdk } = baseTransactionFixture();
    const requestedDeposit = depositCell("85", logic, dao, baseTip, baseTip, {
      isReady: true,
    });

    vi.spyOn(logicManager, "deposit").mockImplementation((txLike) => {
      const tx = ccc.Transaction.from(txLike);
      // The withdrawal request and its owner marker.
      expect(tx.outputs).toHaveLength(2);
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

    expect(tx.outputs.map(({ lock }) => lock)).toEqual([OWNED_OWNER, botLock, botLock]);
    expect(tx.outputs[2]?.capacity).toBe(2n);
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
