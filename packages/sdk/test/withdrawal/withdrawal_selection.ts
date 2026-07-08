import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  ringRequiredLiveDepositFor,
  ringSegments,
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "../../src/withdrawal/withdrawal_selection.ts";
import { depositCell, ringDeposit, TIP } from "./support/withdrawal_selection_support.ts";

describe("selectReadyWithdrawalDeposits ring segments", () => {
  it("keeps adaptive segments above the integer ring length", () => {
    const deposits = Array.from({ length: 181 }, () => ringDeposit(1n, 20n));
    const segments = ringSegments(deposits);

    expect(segments).toHaveLength(256);
  });

  it("selects ring surplus and pins the ring anchor", () => {
    const surplus = ringDeposit(4n, 1n);
    const anchor = ringDeposit(6n, 1n);
    const otherAnchor = ringDeposit(6n, 100n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [surplus, anchor, otherAnchor],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([surplus, anchor, otherAnchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([
          surplus,
          anchor,
          otherAnchor,
        ]),
      }),
    ).toEqual({ deposits: [surplus], requiredLiveDeposits: [anchor] });
  });

  it("identifies ring anchors as required live deposits", () => {
    const surplus = ringDeposit(4n, 1n);
    const anchor = ringDeposit(6n, 1n);
    const otherAnchor = ringDeposit(6n, 100n);
    const requiredLiveDepositFor = ringRequiredLiveDepositFor([
      surplus,
      anchor,
      otherAnchor,
    ]);

    expect(requiredLiveDepositFor(surplus)).toBe(anchor);
    expect(requiredLiveDepositFor(anchor)).toBeUndefined();
    expect(requiredLiveDepositFor(otherAnchor)).toBeUndefined();
  });

  it("rejects malformed epoch denominators", () => {
    expect(() =>
      ringSegments([
        {
          cell: depositCell("bad-epoch"),
          isReady: true,
          udtValue: 1n,
          maturity: ccc.Epoch.from([1n, 0n, 0n]),
        },
      ]),
    ).toThrow("Epoch denominator must be positive");
  });
});

describe("selectReadyWithdrawalDeposits ring exclusions", () => {
  it("does not select the only representative of a ring bucket", () => {
    const anchor = ringDeposit(4n, 1n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [anchor],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([anchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([anchor]),
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });

  it("does not select the only ring representative from another materialization", () => {
    const poolAnchor = ringDeposit(4n, 1n, { key: "anchor" });
    const readyAnchor = ringDeposit(4n, 1n, { key: "anchor" });

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [readyAnchor],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([poolAnchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([poolAnchor]),
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });
});

describe("selectReadyWithdrawalDeposits ring requirements", () => {
  it("pins ring anchors for selected surplus", () => {
    const surplus = ringDeposit(4n, 20n);
    const anchor = ringDeposit(6n, 20n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [surplus, anchor],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([surplus, anchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([surplus, anchor]),
      }),
    ).toEqual({ deposits: [surplus], requiredLiveDeposits: [anchor] });
  });

  it("pins ring anchors for selected surplus from another materialization", () => {
    const poolSurplus = ringDeposit(4n, 20n, { key: "surplus" });
    const readySurplus = ringDeposit(4n, 20n, { key: "surplus" });
    const anchor = ringDeposit(6n, 20n, { key: "anchor" });

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [readySurplus],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([poolSurplus, anchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([poolSurplus, anchor]),
      }),
    ).toEqual({ deposits: [readySurplus], requiredLiveDeposits: [anchor] });
  });

  it("pins non-ready ring anchors for selected ready surplus", () => {
    const surplus = ringDeposit(4n, 20n);
    const nonReadyAnchor = ringDeposit(6n, 20n, { isReady: false });

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [surplus],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([surplus, nonReadyAnchor]),
        requiredLiveDepositFor: ringRequiredLiveDepositFor([surplus, nonReadyAnchor]),
      }),
    ).toEqual({ deposits: [surplus], requiredLiveDeposits: [nonReadyAnchor] });
  });
});
