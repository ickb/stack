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
  it("uses ring surplus, not sparse ready buckets, for ordinary excess", () => {
    const extra = readyDeposit(4n, 20n * 60n * 1000n);
    const ringAnchor = readyDeposit(6n, 25n * 60n * 1000n);
    const sparseReady = readyDeposit(5n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 9n,
      ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
      depositCapacity: 1000n * CKB,
      readyDeposits: [extra, ringAnchor, sparseReady],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({
      kind: "withdraw",
      reason: "excess_ickb_balance",
      deposits: [extra, sparseReady],
      requiredLiveDeposits: [ringAnchor],
    });
    expect(plan.diagnostics?.ring).toMatchObject({
      canCreateRingInventory: false,
      shouldBootstrapRing: false,
    });
  });

  it("keeps ring surplus selection independent of sparse ready buckets", () => {
    const extra = readyDeposit(4n, 20n * 60n * 1000n);
    const ringAnchor = readyDeposit(6n, 25n * 60n * 1000n);
    const sparseReady = readyDeposit(5n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 9n,
      ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
      depositCapacity: 1000n * CKB,
      readyDeposits: [extra, ringAnchor, sparseReady],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({
      kind: "withdraw",
      reason: "excess_ickb_balance",
      deposits: [extra, sparseReady],
      requiredLiveDeposits: [ringAnchor],
    });
  });

  it("does not spend the only ring anchor for excess withdrawal", () => {
    const ringAnchor = readyDeposit(ICKB_DEPOSIT_CAP, 20n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [ringAnchor],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "no_ring_surplus_ready_deposits" });
  });

  it("does not withdraw for excess withdrawal below the withdrawal floor", () => {
    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [
          readyDeposit(4n, 20n * 60n * 1000n),
          readyDeposit(6n, 25n * 60n * 1000n),
        ],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none", reason: "no_withdrawable_ickb" });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("does not withdraw from a duplicate dense future segment to fill an empty target segment", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });

  it("does not withdraw stale ready-shaped entries from the future pool", () => {
    const readyDuplicate = futureDeposit(5n, ICKB_DEPOSIT_CAP, { isReady: true });
    const pendingDuplicate = futureDeposit(6n);
    const secondPendingDuplicate = futureDeposit(7n);
    const otherSegment = futureDeposit(9n);

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          readyDuplicate,
          pendingDuplicate,
          secondPendingDuplicate,
          otherSegment,
        ],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });

  it("uses the full ring instead of future-only anchors", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(5n, ICKB_DEPOSIT_CAP, { isReady: true }),
          futureDeposit(6n, ICKB_DEPOSIT_CAP, { isReady: true }),
          futureDeposit(9n),
        ],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });
});
