import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
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

  it("selects ring surplus and leaves the ring anchor", () => {
    const surplus = ringDeposit(4n, 1n);
    const anchor = ringDeposit(6n, 1n);
    const otherAnchor = ringDeposit(6n, 100n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [surplus, anchor, otherAnchor],
        tip: TIP,
        maxAmount: 4n,
        canSelectDeposit: ringSurplusDepositFilter([surplus, anchor, otherAnchor]),
      }),
    ).toEqual([surplus]);
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
      }),
    ).toEqual([]);
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
      }),
    ).toEqual([]);
  });
});
