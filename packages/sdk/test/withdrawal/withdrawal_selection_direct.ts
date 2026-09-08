import { describe, expect, it } from "vitest";
import { selectReadyWithdrawalDeposits } from "../../src/withdrawal/withdrawal_selection.ts";
import { readyDeposit, TIP } from "./support/withdrawal_selection_support.ts";

const MINUTE_MS = 60n * 1000n;

describe("selectReadyWithdrawalDeposits greedy walk", () => {
  it("walks by maturity and takes every deposit that still fits", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * MINUTE_MS),
      readyDeposit(5n, 30n * MINUTE_MS),
      readyDeposit(4n, 45n * MINUTE_MS),
    ];

    // 6 fits, 5 would exceed 10, 5 again, then 4 fits.
    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
      }),
    ).toEqual([deposits[0], deposits[3]]);
  });

  it("orders candidates by ready maturity, not by input order", () => {
    const earlier = readyDeposit(5n, 20n * MINUTE_MS);
    const later = readyDeposit(5n, 45n * MINUTE_MS);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [later, earlier],
        tip: TIP,
        maxAmount: 5n,
      }),
    ).toEqual([earlier]);
  });

  it("does not select a ready deposit above the requested amount", () => {
    const deposits = [readyDeposit(11n, 0n), readyDeposit(10n, 15n * MINUTE_MS)];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
      }),
    ).toEqual([deposits[1]]);
  });

  it("returns no deposits for a non-positive amount", () => {
    const deposits = [readyDeposit(1n, 0n)];

    expect(
      selectReadyWithdrawalDeposits({ readyDeposits: deposits, tip: TIP, maxAmount: 0n }),
    ).toEqual([]);
  });

  it("filters candidates before walking them", () => {
    const blocked = readyDeposit(5n, 0n, "blocked");
    const allowed = readyDeposit(5n, 1n, "allowed");

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [blocked, allowed],
        tip: TIP,
        maxAmount: 5n,
        canSelectDeposit: (deposit) => deposit !== blocked,
      }),
    ).toEqual([allowed]);
  });
});

describe("selectReadyWithdrawalDeposits input checks", () => {
  it("rejects non-ready deposits with the offending outpoint", () => {
    const nonReady = { ...readyDeposit(1n, 0n, "not-ready"), isReady: false };

    expect(() =>
      selectReadyWithdrawalDeposits({
        readyDeposits: [nonReady],
        tip: TIP,
        maxAmount: 1n,
      }),
    ).toThrow("Withdrawal deposit not-ready is not ready");
  });

  it("rejects duplicate deposits with the offending outpoint", () => {
    const first = readyDeposit(1n, 0n, "duplicate");
    const second = readyDeposit(1n, 1n, "duplicate");

    expect(() =>
      selectReadyWithdrawalDeposits({
        readyDeposits: [first, second],
        tip: TIP,
        maxAmount: 2n,
      }),
    ).toThrow("Withdrawal deposit duplicate is duplicated");
  });
});
