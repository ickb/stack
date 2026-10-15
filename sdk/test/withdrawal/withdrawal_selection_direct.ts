import { describe, expect, it } from "vitest";
import {
  fitWithdrawalDeposits,
  sortByClaim,
} from "../../src/conversion/withdrawal_ring.ts";
import { DAO_OUTPUT_LIMIT } from "../../src/dao.ts";
import { readyDeposit } from "./support/withdrawal_selection_support.ts";

const MINUTE_MS = 60n * 1000n;

describe("fitWithdrawalDeposits greedy walk", () => {
  it("walks by claim and takes every deposit that still fits", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * MINUTE_MS),
      readyDeposit(5n, 30n * MINUTE_MS),
      readyDeposit(4n, 45n * MINUTE_MS),
    ];

    // 6 fits, 5 would exceed 10, 5 again, then 4 fits.
    expect(fitWithdrawalDeposits(deposits, 10n)).toEqual([deposits[0], deposits[3]]);
  });

  it("stops at the requests one transaction can carry, even for zero-value deposits", () => {
    // A deposit made without iCKB Logic running carries no iCKB, so it always fits the
    // amount; a flood of them must not make the chain, and every prefix built from it, grow.
    const oversized = readyDeposit(1n, 0n, "oversized");
    const empties = Array.from({ length: 40 }, (_, index) =>
      readyDeposit(0n, BigInt(index + 1) * MINUTE_MS, `d-${String(index)}`),
    );

    // The cap counts selected deposits, not candidates walked: the skipped one takes no slot.
    const selected = fitWithdrawalDeposits([oversized, ...empties], 0n);
    expect(selected).toHaveLength(DAO_OUTPUT_LIMIT / 2);
    expect(selected).not.toContain(oversized);
  });

  it("takes the candidates in the given order", () => {
    const earlier = readyDeposit(5n, 20n * MINUTE_MS);
    const later = readyDeposit(5n, 45n * MINUTE_MS);

    expect(fitWithdrawalDeposits([later, earlier], 5n)).toEqual([later]);
    expect(fitWithdrawalDeposits(sortByClaim([later, earlier]), 5n)).toEqual([earlier]);
  });

  it("does not select a ready deposit above the requested amount", () => {
    const deposits = [readyDeposit(11n, 0n), readyDeposit(10n, 15n * MINUTE_MS)];

    expect(fitWithdrawalDeposits(deposits, 10n)).toEqual([deposits[1]]);
  });

  it("returns no deposits for a non-positive amount", () => {
    const deposits = [readyDeposit(1n, 0n)];

    expect(fitWithdrawalDeposits(deposits, 0n)).toEqual([]);
  });
});
