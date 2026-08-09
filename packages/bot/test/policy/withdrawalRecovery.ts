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
  it("breaks ring anchors below the useful CKB recovery threshold", () => {
    const anchor = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const otherSegment = futureDeposit(120n * 60n * 1000n, 4n * ICKB_DEPOSIT_CAP);
    const threshold = CKB_RESERVE + 100n;

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP,
        ckbBalance: threshold - 1n,
        depositCapacity: 1000n * CKB,
        ckbRecoveryThreshold: threshold,
        readyDeposits: [anchor],
        poolDepositsRest: [otherSegment],
      }),
    ).toMatchObject({ kind: "withdraw", reason: "reserve_recovery", deposits: [anchor] });
  });

  it("does not break ring anchors at the useful CKB recovery threshold", () => {
    const anchor = readyDeposit(ICKB_DEPOSIT_CAP, 45n * 60n * 1000n);
    const otherSegment = futureDeposit(120n * 60n * 1000n, 4n * ICKB_DEPOSIT_CAP);
    const threshold = CKB_RESERVE + 100n;

    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE + ICKB_DEPOSIT_CAP,
        ckbBalance: threshold,
        depositCapacity: 1000n * CKB,
        ckbRecoveryThreshold: threshold,
        readyDeposits: [anchor],
        poolDepositsRest: [otherSegment],
      }),
    ).toMatchObject({ kind: "none", reason: "no_ring_surplus_ready_deposits" });
  });

  it("requests ring-surplus withdrawals when iCKB is above the withdrawal floor", () => {
    const first = readyDeposit(4n, 20n * 60n * 1000n);
    const second = readyDeposit(6n, 25n * 60n * 1000n);
    const third = readyDeposit(5n, 40n * 60n * 1000n);

    const plan = planRebalance({
      outputSlots: 6,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + 9n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n,
      ickbRefillThreshold: TARGET_ICKB_BALANCE,
      readyDeposits: [first, second, third],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({
      kind: "withdraw",
      deposits: [first, third],
      requiredLiveDeposits: [second],
    });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("does not seed or withdraw ring inventory when the reserve gate fails", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("seeds ring inventory even when one more deposit would cross the withdrawal floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });
});
