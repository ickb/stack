import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  botWithdrawalCkb,
  cumulativeCkbMaturing,
  mergeBotCkb,
  normalizeCountLimit,
  poolDepositCkb,
  poolDepositsKey,
  positiveMapValueSum,
  sortDepositsByMaturity,
  sumDirectWithdrawalSurplus,
  sumUdtValue,
} from "../../../src/conversion/sdk_value_helpers.ts";
import {
  maxMaturity,
  projectAccountAvailability,
} from "../../../src/estimate/sdk_projection.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";
import {
  nativeUdtCell,
  plainCapacityCell,
  projectionReadyDeposit,
  withdrawalValue,
} from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { baseTip, ratio } from "../../transaction/base/support/sdk_core_support.ts";

describe("sdk projection value helpers", () => {
  it("covers CKB projection helper branches", () => {
    const ready = withdrawalValue({ ckbValue: 10n, isReady: true, byte: "41" });
    const pending = withdrawalValue({
      ckbValue: 20n,
      isReady: false,
      maturityUnix: 30n,
      byte: "42",
    });
    const readyDeposit = projectionReadyDeposit(5n, 40n, { ckbValue: 50n, id: "43" });
    const pendingDeposit = projectionReadyDeposit(7n, 60n, {
      ckbValue: 70n,
      id: "44",
      isReady: false,
    });
    const left = new Map([["a", 1n]]);
    const right = new Map([
      ["a", 2n],
      ["b", 3n],
    ]);

    const reserved = -ccc.fixedPointFrom("2000");
    const readyCkb = botWithdrawalCkb([ready, pending], baseTip).ready;

    expect(readyCkb.get(ready.owner.cell.cellOutput.lock.toHex())).toBe(reserved + 10n);
    expect(botWithdrawalCkb([ready, pending], baseTip).maturing).toEqual([
      { ckbValue: 20n, maturity: 30n },
    ]);
    expect(
      cumulativeCkbMaturing([
        { ckbValue: 2n, maturity: 2n },
        { ckbValue: 3n, maturity: 1n },
      ]),
    ).toEqual([
      { ckbCumulative: 3n, maturity: 1n },
      { ckbCumulative: 5n, maturity: 2n },
    ]);
    expect(mergeBotCkb(left, right).get("a")).toBe(3n);
    expect(
      positiveMapValueSum(
        new Map([
          ["a", -1n],
          ["b", 3n],
        ]),
      ),
    ).toBe(3n);
    expect(
      poolDepositCkb(
        {
          deposits: [readyDeposit, pendingDeposit],
          readyDeposits: [readyDeposit],
          id: "p",
        },
        baseTip,
      ),
    ).toEqual({
      ready: 50n,
      maturing: [{ ckbValue: 70n, maturity: 60n }],
    });
    expect(poolDepositsKey([pendingDeposit, readyDeposit], baseTip)).toContain("pending");
    expect(sortDepositsByMaturity([pendingDeposit, readyDeposit], baseTip)).toEqual([
      readyDeposit,
      pendingDeposit,
    ]);
    expect(sumDirectWithdrawalSurplus([readyDeposit], ratio)).toBe(45n);
    expect(sumUdtValue([readyDeposit, pendingDeposit])).toBe(12n);
    expect(normalizeCountLimit(2)).toBe(2);
    expect(normalizeCountLimit(0)).toBe(0);
    expect(normalizeCountLimit(0.5)).toBe(0);
  });
});

describe("sdk projection account availability", () => {
  it("projects pending and available account values", () => {
    const pending = projectionOrderGroup({
      ckbValue: 2n,
      udtValue: 3n,
      isDualRatio: false,
      isMatchable: true,
    });
    const dual = projectionOrderGroup({
      ckbValue: 5n,
      udtValue: 7n,
      isDualRatio: true,
      isMatchable: true,
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
      [pending, dual],
    );

    expect(projection.availableOrders).toEqual([dual]);
    expect(projection.pendingOrders).toEqual([pending]);
    expect(projection.ckbBalance).toBe(projection.ckbAvailable + projection.ckbPending);
    expect(projection.ickbBalance).toBe(
      projection.ickbAvailable + projection.ickbPending,
    );
    expect(maxMaturity(1n, 2n)).toBe(2n);
    expect(maxMaturity(3n, 2n)).toBe(3n);
  });
});
