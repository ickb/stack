import { describe, expect, it } from "vitest";
import { type IckbDepositCell } from "@ickb/core";
import {
  selectExactReadyWithdrawalDepositCandidates,
  selectExactReadyWithdrawalDeposits,
  selectReadyWithdrawalCleanupDeposit,
  selectReadyWithdrawalDeposits,
} from "./withdrawal_selection.js";

const TIP = {} as never;

function readyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
): IckbDepositCell {
  return {
    isReady: true,
    udtValue,
    maturity: {
      toUnix: (): bigint => maturityUnix,
    },
  } as unknown as IckbDepositCell;
}

function scoredReadyDeposit(
  udtValue: bigint,
  maturityUnix: bigint,
  score: bigint,
): IckbDepositCell & { score: bigint } {
  const deposit = readyDeposit(udtValue, maturityUnix) as IckbDepositCell & { score: bigint };
  deposit.score = score;
  return deposit;
}

describe("selectReadyWithdrawalDeposits", () => {
  it("prefers the fullest valid subset under the target amount", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * 60n * 1000n),
      readyDeposit(5n, 30n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        preserveSingletons: false,
      }).deposits,
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
        preserveSingletons: false,
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
        preserveSingletons: false,
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
        preserveSingletons: false,
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });

  it("does not select a ready deposit above the requested amount", () => {
    const deposits = [
      readyDeposit(11n, 0n),
      readyDeposit(10n, 15n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        minCount: 1,
        maxCount: 1,
        preserveSingletons: false,
      }).deposits,
    ).toEqual([deposits[1]]);
  });

  it("does not use protected crowded anchors to satisfy exact-count selection", () => {
    const extra = readyDeposit(4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(6n, 25n * 60n * 1000n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [extra, protectedAnchor],
        tip: TIP,
        maxAmount: 10n,
        minCount: 2,
        maxCount: 2,
        preserveSingletons: true,
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });

  it("keeps earlier-ranked deposits when equal-total subsets tie", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(4n, 15n * 60n * 1000n),
      readyDeposit(6n, 30n * 60n * 1000n),
      readyDeposit(4n, 45n * 60n * 1000n),
    ];

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        preserveSingletons: false,
      }).deposits,
    ).toEqual([deposits[0], deposits[1]]);
  });

  it("pins protected crowded anchors for selected extras", () => {
    const extra = readyDeposit(4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(6n, 25n * 60n * 1000n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [extra, protectedAnchor],
        tip: TIP,
        maxAmount: 4n,
      }),
    ).toEqual({
      deposits: [extra],
      requiredLiveDeposits: [protectedAnchor],
    });
  });

  it("preserves singleton anchors when requested", () => {
    const singleton = readyDeposit(5n, 0n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [singleton],
        tip: TIP,
        maxAmount: 5n,
        preserveSingletons: true,
      }),
    ).toEqual({ deposits: [], requiredLiveDeposits: [] });
  });

  it("can spend singleton anchors when caller unlocks them", () => {
    const singleton = readyDeposit(5n, 0n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [singleton],
        tip: TIP,
        maxAmount: 5n,
        preserveSingletons: false,
      }),
    ).toEqual({ deposits: [singleton], requiredLiveDeposits: [] });
  });

  it("uses near-ready refill as a singleton tie-break once anchors unlock", () => {
    const earlierSingleton = readyDeposit(5n, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(5n, 45n * 60n * 1000n);
    const nearReadyRefill = readyDeposit(4n, 105n * 60n * 1000n);

    expect(
      selectReadyWithdrawalDeposits({
        readyDeposits: [earlierSingleton, laterSingleton],
        nearReadyDeposits: [nearReadyRefill],
        tip: TIP,
        maxAmount: 5n,
        preserveSingletons: false,
      }).deposits,
    ).toEqual([laterSingleton]);
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
        preserveSingletons: false,
      }).deposits,
    ).toEqual([deposits[30]]);
  });
});

describe("selectExactReadyWithdrawalDeposits", () => {
  it("returns an exact-count selection when available", () => {
    const deposits = [
      readyDeposit(10n, 0n),
      readyDeposit(1n, 15n * 60n * 1000n),
      readyDeposit(1n, 30n * 60n * 1000n),
    ];

    expect(
      selectExactReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 10n,
        count: 2,
        preserveSingletons: false,
      })?.deposits,
    ).toEqual([deposits[1], deposits[2]]);
  });

  it("returns undefined when an exact-count selection is unavailable", () => {
    const deposits = [
      readyDeposit(6n, 0n),
      readyDeposit(5n, 15n * 60n * 1000n),
      readyDeposit(5n, 30n * 60n * 1000n),
    ];

    expect(
      selectExactReadyWithdrawalDeposits({
        readyDeposits: deposits,
        tip: TIP,
        maxAmount: 9n,
        count: 2,
        preserveSingletons: false,
      }),
    ).toBeUndefined();
  });

  it("returns scored and unscored candidates for each maturity bucket", () => {
    const earlier = scoredReadyDeposit(8n, 30n * 60n * 1000n, 1n);
    const laterHigherScore = scoredReadyDeposit(8n, 2n * 60n * 60n * 1000n, 2n);

    expect(
      selectExactReadyWithdrawalDepositCandidates({
        readyDeposits: [laterHigherScore, earlier],
        tip: TIP,
        maxAmount: 10n,
        count: 1,
        preserveSingletons: false,
        score: (deposit) => (deposit as IckbDepositCell & { score: bigint }).score,
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
        preserveSingletons: false,
        score: (deposit) => (deposit as IckbDepositCell & { score: bigint }).score,
        maturityBucket: () => 0n,
      }).map((selection) => selection.deposits),
    ).toEqual([
      [scoredFirst, scoredSecond],
      [fullerFirst, fullerSecond],
    ]);
  });
});

describe("selectReadyWithdrawalCleanupDeposit", () => {
  it("selects an over-cap crowded extra and pins its protected anchor", () => {
    const extra = readyDeposit(11n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(12n, 25n * 60n * 1000n);

    expect(
      selectReadyWithdrawalCleanupDeposit({
        readyDeposits: [extra, protectedAnchor],
        tip: TIP,
        minAmountExclusive: 10n,
        maxAmount: 11n,
      }),
    ).toEqual({ deposit: extra, requiredLiveDeposit: protectedAnchor });
  });

  it("does not select the protected crowded anchor", () => {
    const extra = readyDeposit(11n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(12n, 25n * 60n * 1000n);

    expect(
      selectReadyWithdrawalCleanupDeposit({
        readyDeposits: [extra, protectedAnchor],
        tip: TIP,
        minAmountExclusive: 11n,
        maxAmount: 12n,
      }),
    ).toBeUndefined();
  });

  it("respects the cleanup amount ceiling", () => {
    const extra = readyDeposit(11n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(12n, 25n * 60n * 1000n);

    expect(
      selectReadyWithdrawalCleanupDeposit({
        readyDeposits: [extra, protectedAnchor],
        tip: TIP,
        minAmountExclusive: 10n,
        maxAmount: 10n,
      }),
    ).toBeUndefined();
  });
});
