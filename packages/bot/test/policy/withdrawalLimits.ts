import { describe, expect, it } from "vitest";
import { planRebalanceWithdrawal } from "../../src/policy/withdrawal.ts";
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
  it("returns none for tiny excess with a near-cap crowded extra", () => {
    const sparseReady = readyDeposit(5n, 0n);
    const crowdedEarly = readyDeposit(ICKB_DEPOSIT_CAP - 1n, 20n * 60n * 1000n);
    const crowdedLate = readyDeposit(ICKB_DEPOSIT_CAP, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [sparseReady, crowdedEarly, crowdedLate],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("returns none when neither extras nor sparse ready deposits fit", () => {
    const sparseReady = readyDeposit(6n, 0n);
    const crowdedProtected = readyDeposit(6n, 20n * 60n * 1000n);
    const crowdedExtra = readyDeposit(7n, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 5n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [crowdedExtra, crowdedProtected, sparseReady],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "none",
      reason: "ring_surplus_withdrawal_over_budget",
    });
  });

  it("limits withdrawal requests by the available output slots", () => {
    const first = readyDeposit(3n, 0n);
    const second = readyDeposit(3n, 20n * 60n * 1000n);
    const third = readyDeposit(3n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 5,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 10n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [first, second, third],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "withdraw", deposits: [second, third] });
  });

  it("caps withdrawal requests at thirty deposits", () => {
    const readyDeposits = Array.from({ length: 31 }, () => readyDeposit(1n, 0n));

    const plan = planRebalance({
      outputSlots: 100,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + 100n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      readyDeposits,
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "withdraw" });
    expect(plan.kind === "withdraw" ? plan.deposits : []).toHaveLength(30);
  });
});

describe("planRebalanceWithdrawal diagnostics", () => {
  it("carries diagnostics on withdrawal and no-op plans", () => {
    const diagnostics = ringDiagnostics();
    const anchor = readyDeposit(1n, 0n);
    const surplus = readyDeposit(1n, 0n);

    expect(
      planRebalanceWithdrawal({
        outputSlots: 2,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 2n,
        ckbBalance: 2000n * CKB,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        ckbRecoveryThreshold: 1000n * CKB,
        poolDeposits: [anchor, surplus],
        readyDeposits: [anchor, surplus],
        diagnostics,
      }),
    ).toMatchObject({ kind: "withdraw", diagnostics });

    expect(
      planRebalanceWithdrawal({
        outputSlots: 2,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE,
        ckbBalance: 2000n * CKB,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        ckbRecoveryThreshold: 1000n * CKB,
        poolDeposits: [],
        readyDeposits: [],
        diagnostics,
      }),
    ).toEqual({ kind: "none", reason: "no_withdrawable_ickb", diagnostics });
  });
});

function ringDiagnostics(): Parameters<typeof planRebalanceWithdrawal>[0]["diagnostics"] {
  return {
    ring: {
      poolDepositCount: 0,
      canCreateRingInventory: false,
      shouldBootstrapRing: false,
      ringLength: 180n,
      segmentCount: 1,
      targetSegmentIndex: 0,
      targetSegmentUdtValue: 0n,
      totalPoolUdt: 0n,
      depositsShareOneSegment: true,
      segments: [
        {
          index: 0,
          depositCount: 0,
          udtValue: 0n,
          isTarget: true,
          protectedDepositCount: 0,
          protectedUdtValue: 0n,
          protectedOutPoints: [],
          surplusDepositCount: 0,
          surplusUdtValue: 0n,
          surplusOutPoints: [],
        },
      ],
    },
  };
}

describe(PLAN_REBALANCE_SUITE, () => {
  it("does nothing when iCKB is above the withdrawal floor but ring surplus would cut below the buffer", () => {
    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + 3n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [readyDeposit(ICKB_DEPOSIT_CAP + 4n, 0n)],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("withdraws one over-cap ring surplus and pins its ring anchor", () => {
    const first = readyDeposit(ICKB_DEPOSIT_CAP + CKB, 20n * 60n * 1000n);
    const second = readyDeposit(ICKB_DEPOSIT_CAP + CKB, 25n * 60n * 1000n);

    expect(
      planRebalance({
        outputSlots: 6,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP + CKB,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n,
        ickbRefillThreshold: TARGET_ICKB_BALANCE,
        readyDeposits: [first, second],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({
      kind: "withdraw",
      deposits: [second],
      requiredLiveDeposits: [first],
    });
  });
});
