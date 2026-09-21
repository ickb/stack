import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  fitWithdrawalDeposits,
  ringSegments,
  ringSurplusDepositFilter,
} from "../../src/conversion/withdrawal_ring.ts";
import { ringDeposit } from "./support/withdrawal_selection_support.ts";

describe("fitWithdrawalDeposits ring segments", () => {
  it("keeps adaptive segments above the integer ring length", () => {
    const deposits = Array.from({ length: 181 }, () => ringDeposit(1n, 20n));
    const segments = ringSegments(deposits);

    expect(segments).toHaveLength(256);
  });

  it("selects ring surplus and leaves the ring anchor", () => {
    const surplus = ringDeposit(4n, 1n);
    const anchor = ringDeposit(6n, 1n);
    const otherAnchor = ringDeposit(6n, 100n);
    // A segment's anchor is its largest deposit not ready, else its largest: with the
    // small one not ready it anchors its segment and the larger one is surplus.
    expect(
      [surplus, anchor, otherAnchor].filter(
        ringSurplusDepositFilter([surplus, anchor, otherAnchor], [anchor, otherAnchor]),
      ),
    ).toEqual([anchor]);

    expect(
      fitWithdrawalDeposits(
        [surplus, anchor, otherAnchor].filter(
          ringSurplusDepositFilter(
            [surplus, anchor, otherAnchor],
            [surplus, anchor, otherAnchor],
          ),
        ),
        4n,
      ),
    ).toEqual([surplus]);
  });

  it("rejects malformed epoch denominators", () => {
    const deposit = ringDeposit(1n, 1n);
    Object.assign(deposit, { claimEpoch: ccc.Epoch.from([1n, 0n, 0n]) });

    expect(() => ringSegments([deposit])).toThrow("Epoch denominator must be positive");
  });
});

describe("fitWithdrawalDeposits ring exclusions", () => {
  it("does not select the only representative of a ring bucket", () => {
    const anchor = ringDeposit(4n, 1n);

    expect(
      fitWithdrawalDeposits(
        [anchor].filter(ringSurplusDepositFilter([anchor], [anchor])),
        4n,
      ),
    ).toEqual([]);
  });

  it("does not select the only ring representative from another materialization", () => {
    const poolAnchor = ringDeposit(4n, 1n, { key: "anchor" });
    const readyAnchor = ringDeposit(4n, 1n, { key: "anchor" });

    expect(
      fitWithdrawalDeposits(
        [readyAnchor].filter(ringSurplusDepositFilter([poolAnchor], [poolAnchor])),
        4n,
      ),
    ).toEqual([]);
  });
});
