import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectState } from "../../../src/conversion/projection.ts";
import type { AccountState, State } from "../../../src/conversion/types.ts";
import { DAO_HEADER_INDEX_LIMIT } from "../../../src/dao.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import {
  makeOrderGroup,
  projectionOrderGroup,
} from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_ACCOUNT: AccountState = {
  capacityCells: [],
  nativeUdtCells: [],
  receipts: [],
  withdrawalGroups: [],
};

function project(account: Partial<AccountState>, orders: OrderGroup[] = []): State {
  return projectState(state(), { ...EMPTY_ACCOUNT, ...account }, orders, script("11"));
}

describe("projectState account values", () => {
  it("splits actionable and pending account value", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const readyWithdrawal = withdrawalValue({
      ckbValue: 11n,
      udtValue: 13n,
      isReady: true,
      byte: "32",
    });
    const pendingWithdrawal = withdrawalValue({
      ckbValue: 17n,
      udtValue: 19n,
      isReady: false,
      byte: "33",
    });
    const availableOrder = projectionOrderGroup({
      ckbValue: 23n,
      udtValue: 29n,
      isDualRatio: false,
      isMatchable: false,
    });
    // A sell past par: the bot takes it whole, so it stays on the book.
    const pendingOrder = makeOrderGroup({
      ownerLock: script("11"),
      txHashByte: "71",
      ratio: { ckbScale: 2n, udtScale: 1n },
      isCkb2Udt: false,
      udtValue: 10n ** 10n,
    }).group;
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = project(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        receipts: [receiptValue(41n, 43n)],
        withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
      },
      [availableOrder, pendingOrder],
    );

    expect(projection.readyWithdrawals).toEqual([readyWithdrawal]);
    expect(projection.pendingWithdrawals).toEqual([pendingWithdrawal]);
    expect(projection.availableOrders).toEqual([availableOrder]);
    expect(projection.pendingOrders).toEqual([pendingOrder]);
    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projection.ckbNative).toBe(liquidCkb);
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ckbAvailable).toBe(liquidCkb + 41n + 11n + 23n);
    expect(projection.ickbAvailable).toBe(7n + 43n + 29n);
    // The withdrawal's iCKB is not the account's: only the pending order's counts.
    expect(projection.ckbBalance).toBe(
      projection.ckbAvailable + 17n + pendingOrder.ckbValue,
    );
    expect(projection.ickbBalance).toBe(projection.ickbAvailable + pendingOrder.udtValue);
  });

  it("keeps ready as many matured withdrawals as the deployed script addresses, receipts aside", () => {
    const matured = Array.from({ length: DAO_HEADER_INDEX_LIMIT + 1 }, () =>
      withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "32" }),
    );

    const projection = project({
      receipts: [receiptValue(41n, 43n)],
      withdrawalGroups: matured,
    });

    // The withdrawals' deposit headers go first, so the receipt costs no slot; the last
    // withdrawal waits a turn.
    expect(projection.readyWithdrawals).toHaveLength(DAO_HEADER_INDEX_LIMIT);
    expect(projection.pendingWithdrawals).toHaveLength(1);
    expect(projection.ckbAvailable).toBe(41n + 11n * BigInt(DAO_HEADER_INDEX_LIMIT));
    expect(projection.ckbBalance).toBe(41n + 11n * BigInt(matured.length));
  });

  it("derives native iCKB from xUDT cells and counts their capacity as CKB", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = project({
      capacityCells: [plainCapacityCell(nativeCkb)],
      nativeUdtCells: [nativeUdt],
    });

    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ckbNative).toBe(liquidCkb);
    expect(projection.ckbAvailable).toBe(liquidCkb);
    expect(projection.ckbBalance).toBe(liquidCkb);
  });

  it("budgets a collectable order whatever its matchability", () => {
    // A matchable buy at par fails the bot's whole-fill rule, so it is collected.
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = project({}, [matchable]);

    expect(projection.availableOrders).toEqual([matchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(31n);
    expect(projection.ickbAvailable).toBe(37n);
    expect(projection.ckbBalance).toBe(31n);
    expect(projection.ickbBalance).toBe(37n);
  });

  it("does not count withdrawal UDT as available or pending iCKB", () => {
    const nativeUdt = nativeUdtCell(7n, { byte: "45" });

    const projection = project({
      nativeUdtCells: [nativeUdt],
      withdrawalGroups: [
        withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "34" }),
        withdrawalValue({ ckbValue: 17n, udtValue: 19n, isReady: false, byte: "35" }),
      ],
    });

    expect(projection.ckbAvailable).toBe(nativeUdt.cellOutput.capacity + 11n);
    expect(projection.ckbBalance).toBe(nativeUdt.cellOutput.capacity + 11n + 17n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ickbBalance).toBe(7n);
  });
});
