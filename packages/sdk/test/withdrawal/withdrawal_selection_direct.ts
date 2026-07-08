import { describe, expect, it } from "vitest";
import {
  selectExactReadyWithdrawalDepositCandidates,
  selectReadyWithdrawalDeposits,
} from "../../src/withdrawal/withdrawal_selection.ts";
import {
  scoredReadyDeposit,
  type ScoredTestDeposit,
} from "./support/withdrawal_selection_scored_support.ts";
import { readyDeposit, TIP } from "./support/withdrawal_selection_support.ts";

describe("selectReadyWithdrawalDeposits direct fit", () => {
  it("prefers the fullest valid subset under the target amount", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * 60n * 1000n),
      readyDeposit(5n, 30n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({ readyDeposits: deposits, tip: TIP, maxAmount: 10n })
        .deposits,
    ).toEqual([deposits[1], deposits[2]]);
  });

  it("respects the request limit", () => {
    const deposits = [
      readyDeposit(1n, 0n),
      readyDeposit(1n, 15n * 60n * 1000n),
      readyDeposit(1n, 30n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        maxCount: 2,
      }).deposits,
    ).toEqual([deposits[0], deposits[1]]);
  });

  it("supports exact-count direct withdrawal selection", () => {
    const deposits = [
      readyDeposit(10n, 0n),
      readyDeposit(1n, 15n * 60n * 1000n),
      readyDeposit(1n, 30n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        minCount: 2,
        maxCount: 2,
      }).deposits,
    ).toEqual([deposits[1], deposits[2]]);
  });

  it("returns no deposits when an exact-count fit is unavailable", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * 60n * 1000n),
      readyDeposit(5n, 30n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 9n,
        minCount: 2,
        maxCount: 2,
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });
});

describe("selectReadyWithdrawalDeposits direct ordering", () => {
  it("does not select a ready deposit above the requested amount", () => {
    const deposits = [readyDeposit(11n, 0n), readyDeposit(10n, 15n * 60n * 1000n)];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        minCount: 1,
        maxCount: 1,
      }).deposits,
    ).toEqual([deposits[1]]);
  });

  it("keeps earlier-ranked deposits when equal-total subsets tie", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(4n, 15n * 60n * 1000n),
      readyDeposit(6n, 30n * 60n * 1000n),
      readyDeposit(4n, 45n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({ readyDeposits: deposits, tip: TIP, maxAmount: 10n })
        .deposits,
    ).toEqual([deposits[0], deposits[1]]);
  });

  it("prefers the larger total when scored selections tie", () => {
    const lowerTotal = scoredReadyDeposit(4n, 0n, 1n);
    const higherTotal = scoredReadyDeposit(5n, 15n * 60n * 1000n, 1n);

    expect(
      selectExactReadyWithdrawalDepositCandidates({
        readyDeposits: [lowerTotal, higherTotal],
        tip: TIP,
        maxAmount: 5n,
        count: 1,
        score: (deposit: ScoredTestDeposit) => deposit.score,
        maturityBucket: () => 0n,
      })[0]?.deposits,
    ).toEqual([higherTotal]);
  });

  it("uses selection order as the final scored tie-breaker", () => {
    const first = scoredReadyDeposit(5n, 0n, 1n);
    const second = scoredReadyDeposit(5n, 15n * 60n * 1000n, 1n);

    expect(
      selectExactReadyWithdrawalDepositCandidates({
        readyDeposits: [first, second],
        tip: TIP,
        maxAmount: 5n,
        count: 1,
        score: (deposit: ScoredTestDeposit) => deposit.score,
        maturityBucket: () => 0n,
      })[0]?.deposits,
    ).toEqual([first]);
  });
});

describe("selectReadyWithdrawalDeposits direct fallback", () => {
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

  it("returns no deposits when selection bounds are invalid", () => {
    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [readyDeposit(1n, 0n)],
        tip: TIP,
        maxAmount: 1n,
        minCount: 2,
        maxCount: 1,
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });

  it("can select any ready deposit when the caller permits it", () => {
    const sparseReady = readyDeposit(5n, 0n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [sparseReady],
        tip: TIP,
        maxAmount: 5n,
      }),
    ).toEqual({
      deposits: [sparseReady],
      requiredLiveDeposits: [],
    });
  });

  it("orders candidates by ready maturity", () => {
    const earlierSparseReady = readyDeposit(5n, 20n * 60n * 1000n);
    const laterSparseReady = readyDeposit(5n, 45n * 60n * 1000n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [laterSparseReady, earlierSparseReady],
        tip: TIP,
        maxAmount: 5n,
      }).deposits,
    ).toEqual([earlierSparseReady]);
  });

  it("uses greedy fallback for later candidates beyond the bounded best-fit horizon", () => {
    const deposits = [
      ...Array.from({ length: 30 }, (_, index) => readyDeposit(11n, BigInt(index))),
      readyDeposit(10n, 31n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        maxCount: 1,
      }).deposits,
    ).toEqual([deposits[30]]);
  });
});

describe("selectExactReadyWithdrawalDepositCandidates", () => {
  it("returns scored and unscored candidates for each maturity bucket", () => {
    const earlier = scoredReadyDeposit(8n, 30n * 60n * 1000n, 1n);
    const laterHigherScore = scoredReadyDeposit(8n, 2n * 60n * 60n * 1000n, 2n);

    expect(
      selectExactReadyWithdrawalDepositCandidates({
        readyDeposits: [laterHigherScore, earlier],
        tip: TIP,
        maxAmount: 10n,
        count: 1,
        score: (deposit) => deposit.score,
        maturityBucket: (deposit) => deposit.maturity.toUnix(TIP) / (60n * 60n * 1000n),
      }).map((selection) => selection.deposits),
    ).toEqual([[earlier], [laterHigherScore]]);
  });

  it("uses an SDK-owned score for conversion candidates", () => {
    const fullerFirst = scoredReadyDeposit(6n, 0n, 1n);
    const fullerSecond = scoredReadyDeposit(4n, 15n * 60n * 1000n, 1n);
    const scoredFirst = scoredReadyDeposit(3n, 30n * 60n * 1000n, 5n);
    const scoredSecond = scoredReadyDeposit(3n, 45n * 60n * 1000n, 5n);

    expect(
      selectExactReadyWithdrawalDepositCandidates({
        readyDeposits: [fullerFirst, fullerSecond, scoredFirst, scoredSecond],
        tip: TIP,
        maxAmount: 10n,
        count: 2,
        score: (deposit) => deposit.score,
        maturityBucket: () => 0n,
      }).map((selection) => selection.deposits),
    ).toEqual([
      [scoredFirst, scoredSecond],
      [fullerFirst, fullerSecond],
    ]);
  });
});
