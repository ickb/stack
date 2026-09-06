import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { readTesterState } from "../../../../../src/tester/tester/runtime/runtime.ts";
import {
  cell,
  emptyAccountState,
  orderGroup,
  receipt,
  runtimeWithSdk,
  systemState,
  withdrawal,
} from "../../../support/runtime/runtime.ts";

describe("readTesterState", () => {
  it("includes receipts and ready withdrawals in the actionable state", async () => {
    const plainLock = script("11");
    const plainCell = cell(5n, plainLock);
    const userOrder = orderGroup(23n, 29n, false);
    const pendingOrder = orderGroup(31n, 37n, true);
    const receiptCell = receipt(13n, 17n);
    const readyWithdrawal = withdrawal(19n, true);
    const pendingWithdrawal = withdrawal(31n, false, 100n);
    const nativeUdtCell = cell(7n, plainLock, ccc.hexFrom(ccc.numLeToBytes(11n, 16)));
    const currentSystem = systemState();
    const account = {
      capacityCells: [plainCell],
      nativeUdtCells: [nativeUdtCell],
      nativeUdtCapacity: 7n,
      nativeUdtBalance: 11n,
      receipts: [receiptCell],
      withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
    };
    const runtime = runtimeWithSdk({
      getL1AccountState: async () => {
        await Promise.resolve();
        return {
          system: currentSystem,
          user: { orders: [userOrder, pendingOrder] },
          account,
        };
      },
    });
    runtime.primaryLock = plainLock;
    runtime.accountLocks = [plainLock];

    const state = await readTesterState(runtime);

    expect(state.userOrders).toEqual([userOrder, pendingOrder]);
    expect(state.account).toBe(account);
    expect(state.conversionContext).toEqual({
      system: currentSystem,
      receipts: [receiptCell],
      readyWithdrawals: [readyWithdrawal],
      availableOrders: [userOrder, pendingOrder],
      ckbAvailable: plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n,
      ickbAvailable: 11n + 29n + 37n + 17n,
      estimatedMaturity: 100n,
    });
    expect(state.availableCkbBalance).toBe(
      plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n,
    );
    expect(state.pendingCkbBalance).toBe(31n);
    expect(state.totalCkbBalance).toBe(
      plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n + 31n,
    );
    expect(state.plainCkbBalance).toBe(plainCell.cellOutput.capacity);
    expect(state.availableIckbBalance).toBe(11n + 29n + 37n + 17n);
    expect(state.pendingIckbBalance).toBe(0n);
    expect(state.totalIckbBalance).toBe(11n + 29n + 37n + 17n);
  });
});
describe("readTesterState projected balances", () => {
  it("keeps projected order CKB separate from owned plain CKB", async () => {
    const lock = script("11");
    const userOrder = orderGroup(23n, 29n, true);
    const account = emptyAccountState();
    const runtime = runtimeWithSdk({
      getL1AccountState: async () => {
        await Promise.resolve();
        return {
          system: systemState(),
          user: { orders: [userOrder] },
          account,
        };
      },
    });
    runtime.primaryLock = lock;
    runtime.accountLocks = [lock];

    const state = await readTesterState(runtime);

    expect(state.userOrders).toEqual([userOrder]);
    expect(state.account).toBe(account);
    expect(state.availableCkbBalance).toBe(userOrder.ckbValue);
    expect(state.pendingCkbBalance).toBe(0n);
    expect(state.totalCkbBalance).toBe(userOrder.ckbValue);
    expect(state.plainCkbBalance).toBe(0n);
    expect(state.availableIckbBalance).toBe(userOrder.udtValue);
    expect(state.pendingIckbBalance).toBe(0n);
    expect(state.totalIckbBalance).toBe(userOrder.udtValue);
  });
});
