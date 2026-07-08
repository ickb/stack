import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccountAvailability } from "../../../src/sdk.ts";
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
      isDualRatio: true,
      isMatchable: true,
    });
    const pendingOrder = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = projectAccountAvailability(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        nativeUdtCapacity: nativeUdt.cellOutput.capacity,
        nativeUdtBalance: 7n,
        receipts: [receiptValue(41n, 43n)],
        withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
      },
      [availableOrder, pendingOrder],
    );

    expect(projection.readyWithdrawals).toEqual([readyWithdrawal]);
    expect(projection.pendingWithdrawals).toEqual([pendingWithdrawal]);
    expect(projection.availableOrders).toEqual([availableOrder]);
    expect(projection.pendingOrders).toEqual([pendingOrder]);
    expect(projection.ckbNative).toBe(nativeCkb);
    expect(projection.ickbNative).toBe(7n);
    expect(projection.ckbAvailable).toBe(nativeCkb + 41n + 11n + 23n);
    expect(projection.ickbAvailable).toBe(7n + 43n + 29n);
    expect(projection.ckbPending).toBe(17n + 31n);
    expect(projection.ickbPending).toBe(37n);
    expect(projection.ckbBalance).toBe(projection.ckbAvailable + projection.ckbPending);
    expect(projection.ickbBalance).toBe(
      projection.ickbAvailable + projection.ickbPending,
    );
  });

  it("derives native iCKB from xUDT cells instead of the redundant total", () => {
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [nativeUdt],
        nativeUdtCapacity: nativeUdt.cellOutput.capacity,
        nativeUdtBalance: 99n,
        receipts: [],
        withdrawalGroups: [],
      },
      [],
    );

    expect(projection.ickbNative).toBe(7n);
    expect(projection.ickbAvailable).toBe(7n);
  });
});
