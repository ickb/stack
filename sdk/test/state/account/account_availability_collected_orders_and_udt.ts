import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccountAvailability } from "../../../src/conversion/projection.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { ACCOUNT_AVAILABILITY_SUITE } from "./support/account_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(ACCOUNT_AVAILABILITY_SUITE, () => {
  it("budgets the available orders whatever their matchability", () => {
    const matchable = projectionOrderGroup({
      ckbValue: 31n,
      udtValue: 37n,
      isDualRatio: false,
      isMatchable: true,
    });

    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [],
        receipts: [],
        withdrawalGroups: [],
      },
      { available: [matchable], pending: [] },
    );

    expect(projection.availableOrders).toEqual([matchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(31n);
    expect(projection.ickbAvailable).toBe(37n);
    expect(projection.ckbPending).toBe(0n);
    expect(projection.ickbPending).toBe(0n);
  });

  it("counts native UDT capacity as the account's CKB", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });
    const projection = projectAccountAvailability(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        receipts: [],
        withdrawalGroups: [],
      },
      { available: [], pending: [] },
    );

    const liquidCkb = nativeCkb + nativeUdt.cellOutput.capacity;
    expect(projection.ckbNative).toBe(liquidCkb);
    expect(projection.ckbAvailable).toBe(liquidCkb);
    expect(projection.ckbBalance).toBe(liquidCkb);
  });

  it("does not count withdrawal UDT as available or pending iCKB", () => {
    const nativeUdt = nativeUdtCell(7n, { byte: "45" });
    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [nativeUdt],
        receipts: [],
        withdrawalGroups: [
          withdrawalValue({
            ckbValue: 11n,
            udtValue: 13n,
            isReady: true,
            byte: "34",
          }),
          withdrawalValue({
            ckbValue: 17n,
            udtValue: 19n,
            isReady: false,
            byte: "35",
          }),
        ],
      },
      { available: [], pending: [] },
    );

    expect(projection.ckbAvailable).toBe(nativeUdt.cellOutput.capacity + 11n);
    expect(projection.ckbPending).toBe(17n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ickbPending).toBe(0n);
    expect(projection.ickbBalance).toBe(7n);
  });
});
