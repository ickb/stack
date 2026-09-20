import { describe, expect, it } from "vitest";
import { selectReadyWithdrawalDeposits } from "../../src/conversion/withdrawal_ring.ts";
import { readyDeposit } from "./support/withdrawal_selection_support.ts";

const MINUTE_MS = 60n * 1000n;

describe("selectReadyWithdrawalDeposits greedy walk", () => {
  it("walks by claim and takes every deposit that still fits", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * MINUTE_MS),
      readyDeposit(5n, 30n * MINUTE_MS),
      readyDeposit(4n, 45n * MINUTE_MS),
    ];

    // 6 fits, 5 would exceed 10, 5 again, then 4 fits.
    expect(selectReadyWithdrawalDeposits(deposits, 10n)).toEqual([
      deposits[0],
      deposits[3],
    ]);
  });

  it("takes every fitting deposit with no count cap of its own", () => {
    const deposits = Array.from({ length: 40 }, (_, index) =>
      readyDeposit(1n, BigInt(index) * MINUTE_MS, `d-${String(index)}`),
    );

    const selected = selectReadyWithdrawalDeposits(deposits, 40n);

    expect(selected).toHaveLength(40);
  });

  it("orders candidates by claim, not by input order", () => {
    const earlier = readyDeposit(5n, 20n * MINUTE_MS);
    const later = readyDeposit(5n, 45n * MINUTE_MS);

    expect(selectReadyWithdrawalDeposits([later, earlier], 5n)).toEqual([earlier]);
  });

  it("does not select a ready deposit above the requested amount", () => {
    const deposits = [readyDeposit(11n, 0n), readyDeposit(10n, 15n * MINUTE_MS)];

    expect(selectReadyWithdrawalDeposits(deposits, 10n)).toEqual([deposits[1]]);
  });

  it("returns no deposits for a non-positive amount", () => {
    const deposits = [readyDeposit(1n, 0n)];

    expect(selectReadyWithdrawalDeposits(deposits, 0n)).toEqual([]);
  });
});
