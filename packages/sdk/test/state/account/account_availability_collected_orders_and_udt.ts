import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAccountAvailability } from "../../../src/sdk.ts";
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
  it("can budget collected matchable orders as available", () => {
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
        nativeUdtCapacity: 0n,
        nativeUdtBalance: 0n,
        receipts: [],
        withdrawalGroups: [],
      },
      [matchable],
      { collectedOrdersAvailable: true },
    );

    expect(projection.availableOrders).toEqual([matchable]);
    expect(projection.pendingOrders).toEqual([]);
    expect(projection.ckbAvailable).toBe(31n);
    expect(projection.ickbAvailable).toBe(37n);
    expect(projection.ckbPending).toBe(0n);
    expect(projection.ickbPending).toBe(0n);
  });

  it("does not count native UDT capacity as spendable CKB", () => {
    const nativeCkb = ccc.fixedPointFrom(50);
    const nativeUdt = nativeUdtCell(7n, { capacity: 5n });
    const projection = projectAccountAvailability(
      {
        capacityCells: [plainCapacityCell(nativeCkb)],
        nativeUdtCells: [nativeUdt],
        nativeUdtCapacity: nativeUdt.cellOutput.capacity,
        nativeUdtBalance: 7n,
        receipts: [],
        withdrawalGroups: [],
      },
      [],
    );

    expect(projection.ckbNative).toBe(nativeCkb);
    expect(projection.ckbAvailable).toBe(nativeCkb);
    expect(projection.ckbBalance).toBe(nativeCkb);
  });

  it("does not count withdrawal UDT as available or pending iCKB", () => {
    const nativeUdt = nativeUdtCell(7n, { byte: "45" });
    const projection = projectAccountAvailability(
      {
        capacityCells: [],
        nativeUdtCells: [nativeUdt],
        nativeUdtCapacity: nativeUdt.cellOutput.capacity,
        nativeUdtBalance: 7n,
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
      [],
    );

    expect(projection.ckbAvailable).toBe(11n);
    expect(projection.ckbPending).toBe(17n);
    expect(projection.ickbAvailable).toBe(7n);
    expect(projection.ickbPending).toBe(0n);
    expect(projection.ickbBalance).toBe(7n);
  });
});
