import { describe, expect, it } from "vitest";
import { poolCkb } from "../../../src/conversion/maturity.ts";
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
import { baseTip } from "../../transaction/base/support/sdk_core_support.ts";

describe("sdk projection value helpers", () => {
  it("splits the pool into ready CKB and cumulative maturing buckets", () => {
    const readyDeposit = projectionReadyDeposit(5n, 40n, { ckbValue: 50n, id: "43" });
    const later = projectionReadyDeposit(7n, 60n, {
      ckbValue: 70n,
      id: "44",
      isReady: false,
    });
    const earlier = projectionReadyDeposit(2n, 50n, {
      ckbValue: 20n,
      id: "45",
      isReady: false,
    });

    expect(poolCkb([readyDeposit, later, earlier], baseTip)).toEqual({
      ready: 50n,
      maturing: [
        { ckbCumulative: 20n, maturity: 50n },
        { ckbCumulative: 90n, maturity: 60n },
      ],
    });
    expect(sumUdt([readyDeposit, later])).toBe(12n);
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
