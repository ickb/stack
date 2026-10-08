import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  fitWithdrawalDeposits,
  ringSegments,
  ringSurplusDepositFilter,
} from "../../src/conversion/withdrawal_ring.ts";
import { ICKB_DEPOSIT_CAP } from "../../src/udt.ts";
import { ringDeposit } from "./support/withdrawal_selection_support.ts";

describe("fitWithdrawalDeposits ring segments", () => {
  it("keeps adaptive segments above the integer ring length", () => {
    // One segment per two caps: 181 two-cap deposits ask for 181 segments, rounded up.
    const deposits = Array.from({ length: 181 }, () =>
      ringDeposit(2n * ICKB_DEPOSIT_CAP, 20n),
    );
    const segments = ringSegments(deposits);

    expect(segments).toHaveLength(256);
  });

  it("counts segments by pool value, so zero-value deposits add none", () => {
    const spam = Array.from({ length: 1000 }, (_, index) =>
      ringDeposit(0n, BigInt(index % 180), { key: `spam-${String(index)}` }),
    );
    const real = ringDeposit(2n * ICKB_DEPOSIT_CAP, 20n);

    expect(ringSegments([...spam, real])).toHaveLength(1);
    expect(ringSegments([])).toHaveLength(1);
  });

  it("doubles at most once when the bot fills the segments a doubling left empty", () => {
    // Two caps per segment, the most before the ring doubles. One more cap doubles it; filling
    // every segment the doubling left empty with a cap must not double it again.
    const cap = ICKB_DEPOSIT_CAP;
    const pool = [0n, 45n, 90n, 135n].flatMap((epoch) => [
      ringDeposit(cap, epoch, { key: `a-${String(epoch)}` }),
      ringDeposit(cap, epoch, { key: `b-${String(epoch)}` }),
    ]);
    const before = ringSegments(pool).length;

    pool.push(ringDeposit(cap, 1n, { key: "user" }));
    const doubled = ringSegments(pool);
    expect(doubled).toHaveLength(2 * before);

    for (const segment of doubled) {
      if (segment.deposits.length === 0) {
        const epoch = BigInt(Math.ceil((segment.index * 180) / doubled.length));
        pool.push(ringDeposit(cap, epoch, { key: `fill-${String(segment.index)}` }));
      }
    }
    const filled = ringSegments(pool);
    expect(filled).toHaveLength(doubled.length);
    expect(filled.every((segment) => segment.deposits.length > 0)).toBe(true);
  });

  it("selects ring surplus and leaves the ring anchor", () => {
    const surplus = ringDeposit(4n * ICKB_DEPOSIT_CAP, 1n);
    const anchor = ringDeposit(6n * ICKB_DEPOSIT_CAP, 1n);
    const otherAnchor = ringDeposit(6n * ICKB_DEPOSIT_CAP, 100n);
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
        4n * ICKB_DEPOSIT_CAP,
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
