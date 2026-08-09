import { describe, expect, it } from "vitest";
import {
  CKB,
  CKB_RESERVE,
  ICKB_DEPOSIT_CAP,
  NO_POOL_REST,
  PLAN_REBALANCE_SUITE,
  TARGET_ICKB_BALANCE,
  TIP,
  futureDeposit,
  planRebalance,
  readyDeposit,
} from "./fixtures/policy.ts";

describe(PLAN_REBALANCE_SUITE, () => {
  it("does nothing when fewer than two output slots remain", () => {
    expect(
      planRebalance({
        outputSlots: 1,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        ickbRefillThreshold: 1n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toEqual({ kind: "none", reason: "insufficient_output_slots" });
  });

  it("requests one deposit when iCKB is too low and CKB reserve is available", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 2000n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        ickbRefillThreshold: 1n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "low_ickb_balance", quantity: 1 });
  });

  it("does not deposit at the reserve boundary when fee headroom is required", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 1000n * CKB + CKB_RESERVE,
        depositCapacity: 1000n * CKB,
        directDepositFeeHeadroom: 1n,
        ickbRefillThreshold: 1n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "low_ickb_ckb_reserve_unavailable" });
  });

  it("requests one deposit when CKB covers reserve and fee headroom", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 1000n * CKB + CKB_RESERVE + 1n,
        depositCapacity: 1000n * CKB,
        directDepositFeeHeadroom: 1n,
        ickbRefillThreshold: 1n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "low_ickb_balance", quantity: 1 });
  });

  it("does nothing when iCKB is too low but the CKB reserve is unavailable", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 0n,
        ckbBalance: 1999n * 100000000n,
        depositCapacity: 1000n * 100000000n,
        ickbRefillThreshold: 1n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "low_ickb_ckb_reserve_unavailable" });
  });
});

describe(`${PLAN_REBALANCE_SUITE} iCKB refill`, () => {
  it("seeds ring inventory when iCKB is at the refill floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 100n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        ickbRefillThreshold: 100n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "ring_inventory", quantity: 1 });
  });

  it("refills iCKB below the useful match floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 99n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        ickbRefillThreshold: 100n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "low_ickb_balance", quantity: 1 });
  });

  it("does not refill iCKB at the useful match floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: 100n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        ickbRefillThreshold: 100n,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "ring_inventory", quantity: 1 });
  });
});

describe(`${PLAN_REBALANCE_SUITE} near-ready deposits`, () => {
  it("treats sparse next-hour near-ready deposits as ring coverage", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsNearReady: [futureDeposit(105n * 60n * 1000n)],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not treat pending future withdrawal value as liquid CKB for ring seeding", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsNearReady: [
          futureDeposit(105n * 60n * 1000n, 10n * ICKB_DEPOSIT_CAP),
        ],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not let near-ready refill unlock ring anchors", () => {
    const earlierSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const poolNearReadyRefill = readyDeposit(4n, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [earlierSparseReady, laterSparseReady],
        poolDepositsNearReady: [poolNearReadyRefill],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "no_ring_surplus_ready_deposits" });
  });
});

describe(`${PLAN_REBALANCE_SUITE} near-ready ring selection`, () => {
  it("uses near-ready deposits only through full-pool ring policy", () => {
    const firstExtra = readyDeposit(4n, 20n * 60n * 1000n);
    const firstProtected = readyDeposit(5n, 25n * 60n * 1000n);
    const secondExtra = readyDeposit(4n, 40n * 60n * 1000n);
    const secondProtected = readyDeposit(5n, 44n * 60n * 1000n);
    const poolNearReadyRefill = readyDeposit(3n, 105n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 4n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [firstExtra, firstProtected, secondExtra, secondProtected],
      poolDepositsNearReady: [poolNearReadyRefill],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "withdraw", deposits: [secondExtra] });
  });

  it("ignores near-ready refill exactly at the lookahead cutoff", () => {
    const earlierSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const atCutoff = readyDeposit(4n, 120n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [earlierSparseReady, laterSparseReady],
      poolDepositsNearReady: [atCutoff],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({
      kind: "none",
      reason: "no_ring_surplus_ready_deposits",
    });
  });

  it("ignores near-ready refill just outside the one-hour lookahead", () => {
    const earlierSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSparseReady = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const outsideLookahead = readyDeposit(4n, 121n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [earlierSparseReady, laterSparseReady],
      poolDepositsNearReady: [outsideLookahead],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({
      kind: "none",
      reason: "no_ring_surplus_ready_deposits",
    });
  });
});

describe(`${PLAN_REBALANCE_SUITE} cleanup bait`, () => {
  it("does not clean up an exact-cap ready deposit", () => {
    const capBait = futureDeposit(0n, ICKB_DEPOSIT_CAP, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [capBait],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not withdraw the only over-cap ring anchor", () => {
    const tinyExtra = futureDeposit(20n * 60n * 1000n, 1n, { isReady: true });
    const protectedAnchor = futureDeposit(25n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB, {
      isReady: true,
    });

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [tinyExtra, protectedAnchor],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("ignores under-cap non-standard bait for cleanup", () => {
    const dustBait = futureDeposit(0n, ICKB_DEPOSIT_CAP - 1n, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [dustBait],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not clean up near-ready or future non-standard deposits", () => {
    const poolNearReady = futureDeposit(105n * 60n * 1000n, ICKB_DEPOSIT_CAP + CKB);
    const future = futureDeposit(10n, ICKB_DEPOSIT_CAP + CKB);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [],
        poolDepositsNearReady: [poolNearReady],
        poolDepositsRest: [future],
      }),
    ).toMatchObject({ kind: "none" });
  });
});

describe(`${PLAN_REBALANCE_SUITE} cleanup withdrawal floor`, () => {
  it("does not request one ready ring anchor as normal withdrawal", () => {
    const deposit = readyDeposit(ICKB_DEPOSIT_CAP + CKB, 0n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [deposit],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "no_ring_surplus_ready_deposits" });
  });

  it("does not request a full withdrawal that would cut below the withdrawal floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [readyDeposit(ICKB_DEPOSIT_CAP + 2n * CKB, 0n)],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not let near-ready refill unlock cleanup below the withdrawal floor", () => {
    const unsafeReady = futureDeposit(0n, ICKB_DEPOSIT_CAP + 2n * CKB, {
      isReady: true,
    });
    const hugeNearReady = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: CKB_RESERVE,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [unsafeReady],
        poolDepositsNearReady: [hugeNearReady],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });
});

describe(`${PLAN_REBALANCE_SUITE} cleanup near-ready isolation`, () => {
  it("does not clean up the only ring anchor", () => {
    const cleanupReady = futureDeposit(0n, ICKB_DEPOSIT_CAP + CKB, { isReady: true });

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: CKB_RESERVE,
        depositCapacity: 1000n * CKB,
        readyDeposits: [cleanupReady],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not treat near-ready refill as current liquidity budget", () => {
    const unsafeReady = readyDeposit(ICKB_DEPOSIT_CAP + 2n * CKB, 0n);
    const hugeNearReady = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + CKB,
        ckbBalance: CKB_RESERVE,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [unsafeReady],
        poolDepositsNearReady: [hugeNearReady],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not let fake near-ready refill unlock oversized ring anchors", () => {
    const earlierSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const laterSingleton = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const fakeRefill = readyDeposit(10n * ICKB_DEPOSIT_CAP, 105n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP - 1n,
        ckbBalance: CKB_RESERVE,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [earlierSingleton, laterSingleton],
        poolDepositsNearReady: [fakeRefill],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });
});
