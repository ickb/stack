import { describe, expect, it } from "vitest";
import {
  projectAccountAvailability,
  sumUdt,
} from "../../../src/conversion/projection.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  projectionReadyDeposit,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk projection value helpers", () => {
  it("sums the iCKB of deposits", () => {
    expect(
      sumUdt([projectionReadyDeposit(5n, 40n), projectionReadyDeposit(7n, 60n)]),
    ).toBe(12n);
  });
});

describe("sdk projection account availability", () => {
  it("projects pending and available account values", () => {
    const dual = projectionOrderGroup({
      ckbValue: 2n,
      udtValue: 3n,
      isDualRatio: true,
      isMatchable: true,
    });
    const settled = projectionOrderGroup({
      ckbValue: 5n,
      udtValue: 7n,
      isDualRatio: false,
      isMatchable: false,
    });
    const nativeUdt = nativeUdtCell(13n, { byte: "47" });
    const projection = projectAccountAvailability(
      {
        capacityCells: [plainCapacityCell(11n)],
        nativeUdtCells: [nativeUdt],
        receipts: [],
        withdrawalGroups: [],
      },
      { available: [settled], pending: [dual] },
    );

    expect(projection.availableOrders).toEqual([settled]);
    expect(projection.pendingOrders).toEqual([dual]);
    expect(projection.ckbBalance).toBe(projection.ckbAvailable + projection.ckbPending);
    expect(projection.ickbBalance).toBe(
      projection.ickbAvailable + projection.ickbPending,
    );
  });
});
