import { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell, LogicManager, OwnedOwnerManager } from "@ickb/core";
import type { OrderManager } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseTransactionFixture,
  BUILD_BASE_TRANSACTION_SUITE,
} from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { placeholderOrder } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  depositCell,
  placeholderReceipt,
  placeholderWithdrawal,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseClient, baseTip, hash } from "./support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockBaseTransactionStepOrder(options: {
  botLock: ccc.Script;
  logicManager: LogicManager;
  orderManager: OrderManager;
  ownedOwnerManager: OwnedOwnerManager;
  requestedDeposit: IckbDepositCell;
  requiredLiveDeposit: IckbDepositCell;
  steps: string[];
}): void {
  const {
    botLock,
    logicManager,
    orderManager,
    ownedOwnerManager,
    requestedDeposit,
    requiredLiveDeposit,
    steps,
  } = options;
  vi.spyOn(ownedOwnerManager, "requestWithdrawal").mockImplementation(
    async (
      ...[txLike, deposits, lock, , requestOptions]: [
        txLike: ccc.TransactionLike,
        deposits: unknown,
        lock: unknown,
        client: unknown,
        requestOptions: unknown,
      ]
    ) => {
      await Promise.resolve();
      steps.push("request");
      expect(deposits).toEqual([requestedDeposit]);
      expect(lock).toEqual(botLock);
      expect(requestOptions).toEqual({
        requiredLiveDeposits: [requiredLiveDeposit],
      });
      return appendInputAndOutput(txLike, hash("70"), botLock, 1n);
    },
  );
  vi.spyOn(orderManager, "melt").mockImplementation((txLike) => {
    steps.push("orders");
    const tx = ccc.Transaction.from(txLike);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    tx.inputs.push(cellInput("71"));
    return tx;
  });
  vi.spyOn(logicManager, "completeDeposit").mockImplementation((txLike) => {
    steps.push("receipts");
    const tx = ccc.Transaction.from(txLike);
    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(1);
    tx.inputs.push(cellInput("72"));
    return tx;
  });
  vi.spyOn(ownedOwnerManager, "withdraw").mockImplementation(async (txLike) => {
    await Promise.resolve();
    steps.push("withdrawals");
    const tx = ccc.Transaction.from(txLike);
    expect(tx.inputs).toHaveLength(3);
    expect(tx.outputs).toHaveLength(1);
    tx.inputs.push(cellInput("73"));
    return tx;
  });
}

function appendInputAndOutput(
  txLike: ccc.TransactionLike,
  txHash: ccc.Hex,
  lock: ccc.Script,
  capacity: bigint,
): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  expect(tx.inputs).toHaveLength(0);
  expect(tx.outputs).toHaveLength(0);
  tx.inputs.push(ccc.CellInput.from({ previousOutput: { txHash, index: 0n } }));
  tx.outputs.push(ccc.CellOutput.from({ capacity, lock }));
  tx.outputsData.push("0x");
  return tx;
}

function cellInput(byte: string): ccc.CellInput {
  return ccc.CellInput.from({
    previousOutput: {
      txHash: hash(byte),
      index: 0n,
    },
  });
}

describe(BUILD_BASE_TRANSACTION_SUITE, () => {
  it("requests withdrawals before input-only base activity", async () => {
    const { botLock, dao, logic, orderManager, logicManager, ownedOwnerManager, sdk } =
      baseTransactionFixture();
    const steps: string[] = [];
    const requestedDeposit = depositCell("80", logic, dao, baseTip, baseTip, {
      isReady: true,
    });
    const requiredLiveDeposit = depositCell("90", logic, dao, baseTip, baseTip, {
      isReady: true,
    });
    mockBaseTransactionStepOrder({
      botLock,
      logicManager,
      orderManager,
      ownedOwnerManager,
      requestedDeposit,
      requiredLiveDeposit,
      steps,
    });

    const tx = await sdk.buildBaseTransaction(ccc.Transaction.default(), baseClient, {
      withdrawalRequest: {
        deposits: [requestedDeposit],
        requiredLiveDeposits: [requiredLiveDeposit],
        lock: botLock,
      },
      orders: [placeholderOrder],
      receipts: [placeholderReceipt],
      readyWithdrawals: [placeholderWithdrawal],
    });

    expect(steps).toEqual(["request", "orders", "receipts", "withdrawals"]);
    expect(tx.inputs).toHaveLength(4);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputsData).toEqual(["0x"]);
  });
});
