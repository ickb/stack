import { describe, expect, it } from "vitest";
import {
  maxMaturity,
  projectAccountAvailability,
} from "../../../src/conversion/sdk_projection.ts";
import {
  cumulativeCkbMaturing,
  poolDepositCkb,
  sumDirectWithdrawalSurplus,
  sumUdtValue,
} from "../../../src/conversion/sdk_value_helpers.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  projectionReadyDeposit,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, ratio } from "../../transaction/base/support/sdk_core_support.ts";

describe("sdk projection value helpers", () => {
  it("covers CKB projection helper branches", () => {
    const readyDeposit = projectionReadyDeposit(5n, 40n, { ckbValue: 50n, id: "43" });
    const pendingDeposit = projectionReadyDeposit(7n, 60n, {
      ckbValue: 70n,
      id: "44",
      isReady: false,
    });
    expect(
      cumulativeCkbMaturing([
        { ckbValue: 2n, maturity: 2n },
        { ckbValue: 3n, maturity: 1n },
      ]),
    ).toEqual([
      { ckbCumulative: 3n, maturity: 1n },
      { ckbCumulative: 5n, maturity: 2n },
    ]);
    expect(
      poolDepositCkb(
        {
          deposits: [readyDeposit, pendingDeposit],
        },
        baseTip,
      ),
    ).toEqual({
      ready: 50n,
      maturing: [{ ckbValue: 70n, maturity: 60n }],
    });
    expect(sumDirectWithdrawalSurplus([readyDeposit], ratio)).toBe(45n);
    expect(sumUdtValue([readyDeposit, pendingDeposit])).toBe(12n);
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
        nativeUdtCapacity: nativeUdt.cellOutput.capacity,
        nativeUdtBalance: 13n,
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
    expect(maxMaturity(1n, 2n)).toBe(2n);
    expect(maxMaturity(3n, 2n)).toBe(3n);
  });
});
