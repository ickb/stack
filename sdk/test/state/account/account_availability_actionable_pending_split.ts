import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccountAvailability } from "../../../src/conversion/projection.ts";
import { DAO_HEADER_INDEX_LIMIT } from "../../../src/dao.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  receiptValue,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { ACCOUNT_AVAILABILITY_SUITE } from "./support/account_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(ACCOUNT_AVAILABILITY_SUITE, () => {
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
    const pendingOrder = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: true,
      isMatchable: true,
    });
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = projectAccountAvailability(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        receipts: [receiptValue(41n, 43n)],
        withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
      },
      { available: [availableOrder], pending: [pendingOrder] },
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
    expect(projection.ckbPending).toBe(17n + 31n);
    expect(projection.ickbPending).toBe(37n);
    expect(projection.ckbBalance).toBe(projection.ckbAvailable + projection.ckbPending);
    expect(projection.ickbBalance).toBe(
      projection.ickbAvailable + projection.ickbPending,
    );
  });

  it("keeps ready as many matured withdrawals as the deployed script addresses, receipts aside", () => {
    const matured = Array.from({ length: DAO_HEADER_INDEX_LIMIT + 1 }, () =>
      withdrawalValue({ ckbValue: 11n, udtValue: 13n, isReady: true, byte: "32" }),
    );
    const receipt = receiptValue(41n, 43n);

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [receipt],
        withdrawalGroups: matured,
      },
      { available: [], pending: [] },
    );

    // The withdrawals' deposit headers go first, so the receipt costs no slot; the last
    // withdrawal waits a turn.
    expect(projection.readyWithdrawals).toHaveLength(DAO_HEADER_INDEX_LIMIT);
    expect(projection.pendingWithdrawals).toHaveLength(1);
    expect(projection.ckbAvailable).toBe(41n + 11n * BigInt(DAO_HEADER_INDEX_LIMIT));
    expect(projection.ckbPending).toBe(11n);
    expect(projection.ckbBalance).toBe(41n + 11n * BigInt(matured.length));
  });

  it("derives native iCKB from xUDT cells instead of the redundant total", () => {
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [nativeUdt],
        receipts: [],
        withdrawalGroups: [],
      },
      { available: [], pending: [] },
    );

    expect(projection.ickbNative).toBe(7n);
    expect(projection.ickbAvailable).toBe(7n);
  });
});
