import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBaseTransaction } from "../../../src/build.ts";
import { ICKB_LOGIC, OWNED_OWNER } from "../../../src/constants.ts";
import { deposit } from "../../../src/logic.ts";
import { baseTransactionFixture } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const NO_COLLECT = { availableOrders: [], receipts: [], readyWithdrawals: [] };

describe("buildBaseTransaction", () => {
  it("lets callers append a deposit after the withdrawal request path", () => {
    const { botLock, dao, logic } = baseTransactionFixture();
    const requestedDeposit = depositCell("85", logic, dao, baseTip, baseTip, {
      isReady: true,
    });

    let tx = buildBaseTransaction(ccc.Transaction.default(), NO_COLLECT, {
      deposits: [requestedDeposit],
      lock: botLock,
    });
    tx = deposit(tx, 1, ccc.fixedPointFrom(1082), botLock);

    // The request and its owner marker, then the deposit and its receipt.
    expect(tx.outputs.map(({ lock }) => lock)).toEqual([
      OWNED_OWNER,
      botLock,
      ICKB_LOGIC,
      botLock,
    ]);
    expect(tx.outputs[2]?.capacity).toBe(ccc.fixedPointFrom(1082));
  });

  it("lets DAO withdrawal own unbalanced caller prework rejection", () => {
    const { botLock, dao, logic } = baseTransactionFixture();
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
      buildBaseTransaction(tx, NO_COLLECT, {
        deposits: [depositCell("85", logic, dao, baseTip, baseTip, { isReady: true })],
        lock: botLock,
      }),
    ).toThrow("Transaction has different inputs and outputs lengths");
  });
});
