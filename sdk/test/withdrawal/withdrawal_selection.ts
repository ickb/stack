import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  ringSegments,
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "../../src/conversion/withdrawal_ring.ts";
import { ringDeposit, TIP } from "./support/withdrawal_selection_support.ts";

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
      selectReadyWithdrawalDeposits(
        [surplus, anchor, otherAnchor].filter(
          ringSurplusDepositFilter([surplus, anchor, otherAnchor]),
        ),
        4n,
        TIP,
      ),
    ).toEqual([surplus]);
  });

  it("rejects malformed epoch denominators", () => {
    const deposit = ringDeposit(1n, 1n);
    Object.assign(deposit, { maturity: ccc.Epoch.from([1n, 0n, 0n]) });

    expect(() => ringSegments([deposit])).toThrow("Epoch denominator must be positive");
  });
});

describe("selectReadyWithdrawalDeposits ring exclusions", () => {
  it("does not select the only representative of a ring bucket", () => {
    const anchor = ringDeposit(4n, 1n);

    expect(
      selectReadyWithdrawalDeposits(
        [anchor].filter(ringSurplusDepositFilter([anchor])),
        4n,
        TIP,
      ),
    ).toEqual([]);
  });

  it("does not select the only ring representative from another materialization", () => {
    const poolAnchor = ringDeposit(4n, 1n, { key: "anchor" });
    const readyAnchor = ringDeposit(4n, 1n, { key: "anchor" });

    expect(
      selectReadyWithdrawalDeposits(
        [readyAnchor].filter(ringSurplusDepositFilter([poolAnchor])),
        4n,
        TIP,
      ),
    ).toEqual([]);
  });
});
