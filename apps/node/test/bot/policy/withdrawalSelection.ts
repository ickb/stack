import { describe, expect, it } from "vitest";
import {
  CKB,
  ICKB_DEPOSIT_CAP,
  NO_POOL_REST,
  PLAN_REBALANCE_SUITE,
  TARGET_ICKB_BALANCE,
  TIP,
  planRebalance,
  readyDeposit,
} from "./fixtures/policy.ts";

describe(PLAN_REBALANCE_SUITE, () => {
  it("does not prefer crowded ready buckets over ring surplus", () => {
    const sparseReady = readyDeposit(5n, 0n);
    const crowdedEarly = readyDeposit(4n, 20n * 60n * 1000n);
    const crowdedLate = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [sparseReady, crowdedEarly, crowdedLate],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [crowdedEarly],
      requiredLiveDeposits: [sparseReady],
    });
  });

  it("pins required ring deposits for ordinary extra withdrawals", () => {
    const ringAnchor = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);
    const extra = readyDeposit(ICKB_DEPOSIT_CAP - CKB, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP - CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [extra, ringAnchor],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [extra],
      requiredLiveDeposits: [ringAnchor],
    });
  });

  it("uses the earliest ring surplus fit", () => {
    const sparseReady = readyDeposit(5n, 0n);
    const crowdedProtected = readyDeposit(6n, 20n * 60n * 1000n);
    const crowdedExtra = readyDeposit(5n, 25n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 5n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [crowdedExtra, crowdedProtected, sparseReady],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "withdraw", deposits: [sparseReady] });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("uses ring surplus while moderate excess can still thin a crowded bucket", () => {
    const sparseReady = readyDeposit(5n, 0n);
    const crowdedLarge = readyDeposit(9n, 20n * 60n * 1000n);
    const crowdedSmall = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 9n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [sparseReady, crowdedLarge, crowdedSmall],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [sparseReady, crowdedSmall],
      requiredLiveDeposits: [crowdedLarge],
    });
  });

  it("can select sparse ready deposits when ring surplus permits it", () => {
    const sparseReady = readyDeposit(5n, 0n);
    const crowdedLarge = readyDeposit(9n, 20n * 60n * 1000n);
    const crowdedSmall = readyDeposit(4n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 9n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [sparseReady, crowdedLarge, crowdedSmall],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [sparseReady, crowdedSmall],
      requiredLiveDeposits: [crowdedLarge],
    });
  });

  it("pins only ring anchors for selected surplus", () => {
    const lowExtra = readyDeposit(3n, 20n * 60n * 1000n);
    const lowProtected = readyDeposit(5n, 25n * 60n * 1000n);
    const highExtra = readyDeposit(4n, 40n * 60n * 1000n);
    const highProtected = readyDeposit(5n, 44n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 4n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [lowExtra, lowProtected, highExtra, highProtected],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [highExtra],
      requiredLiveDeposits: [lowProtected],
    });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("leaves one deposit in a crowded ready bucket when that already reduces excess", () => {
    const first = readyDeposit(3n, 20n * 60n * 1000n);
    const last = readyDeposit(3n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 6n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [first, last],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [last],
      requiredLiveDeposits: [first],
    });
  });

  it("keeps the latest deposit when crowded bucket values tie", () => {
    const earlier = readyDeposit(3n, 20n * 60n * 1000n);
    const later = readyDeposit(3n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 3n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [earlier, later],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [later],
      requiredLiveDeposits: [earlier],
    });
  });

  it("withdraws sparse ready buckets when they are ring surplus", () => {
    const earlierSparseReady = readyDeposit(5n, 20n * 60n * 1000n);
    const laterSparseReady = readyDeposit(5n, 45n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [earlierSparseReady, laterSparseReady],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [laterSparseReady],
      requiredLiveDeposits: [earlierSparseReady],
    });
  });
});
