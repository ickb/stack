import { describe, expect, it } from "vitest";
import {
  CKB,
  CKB_RESERVE,
  ICKB_DEPOSIT_CAP,
  NO_POOL_REST,
  PLAN_REBALANCE_SUITE,
  RING_LENGTH_EPOCHS,
  TARGET_ICKB_BALANCE,
  TIP,
  futureDeposit,
  planRebalance,
} from "./fixtures/policy.ts";

describe(PLAN_REBALANCE_SUITE, () => {
  it("seeds one future deposit when no future anchors exist", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "deposit", reason: "ring_inventory" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 0,
      canCreateRingInventory: true,
      shouldBootstrapRing: true,
      segmentCount: 1,
      segments: [{ index: 0, depositCount: 0, udtValue: 0n, isTarget: true }],
    });
  });

  it("seeds ring inventory even when liquid iCKB is above the withdrawal floor", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE + CKB,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "deposit", reason: "ring_inventory" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 0,
      canCreateRingInventory: true,
      shouldBootstrapRing: true,
    });
  });

  it("carries ring diagnostics on ring-inventory deposits", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: 100n,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      ickbRefillThreshold: 100n,
      readyDeposits: [],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "deposit", reason: "ring_inventory" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 0,
      shouldBootstrapRing: true,
      segments: [{ isTarget: true }],
    });
  });

  it("does not seed when a lone ring deposit must be preserved", () => {
    const loneDeposit = futureDeposit(9n);

    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: [loneDeposit],
    });

    expect(plan).toMatchObject({ kind: "none" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 1,
      canCreateRingInventory: true,
      shouldBootstrapRing: false,
      segmentCount: 1,
      segments: [
        { index: 0, depositCount: 1, udtValue: ICKB_DEPOSIT_CAP, isTarget: true },
      ],
    });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("seeds, without withdrawing, when two future deposits crowd the same adaptive segment", () => {
    const firstDuplicate = futureDeposit(9n);
    const secondDuplicate = futureDeposit(10n);

    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: [firstDuplicate, secondDuplicate],
    });

    expect(plan).toMatchObject({ kind: "deposit", quantity: 1 });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 2,
      canCreateRingInventory: true,
      ringLength: RING_LENGTH_EPOCHS,
      segmentCount: 2,
      targetSegmentIndex: 0,
      totalPoolUdt: 2n * ICKB_DEPOSIT_CAP,
      depositsShareOneSegment: true,
    });
  });

  it("does not seed when two future deposits already span both adaptive segments", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: [futureDeposit(1n), futureDeposit(9n)],
    });

    expect(plan).toMatchObject({ kind: "none" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 2,
      segmentCount: 2,
      targetSegmentIndex: 0,
      targetSegmentUdtValue: ICKB_DEPOSIT_CAP,
      depositsShareOneSegment: false,
    });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("seeds when the coarse target segment is under-covered by udt per meter", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: [futureDeposit(5n), futureDeposit(9n), futureDeposit(13n)],
    });

    expect(plan).toMatchObject({ kind: "deposit", quantity: 1 });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 3,
      segmentCount: 4,
      targetSegmentIndex: 0,
      targetSegmentUdtValue: 0n,
      depositsShareOneSegment: false,
    });
  });

  it("seeds an empty target segment in high-count pools", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 2000n * CKB,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: Array.from({ length: 181 }, () => futureDeposit(1n)),
    });

    expect(plan).toMatchObject({ kind: "deposit", reason: "ring_inventory" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 181,
      ringLength: RING_LENGTH_EPOCHS,
      segmentCount: 256,
      targetSegmentIndex: 0,
      targetSegmentUdtValue: 0n,
    });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("does not seed when the coarse target segment meets the density threshold", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(1n, 1n),
          futureDeposit(5n, 3n),
          futureDeposit(9n, 4n),
        ],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not seed from zero-total future coverage", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(9n, 0n), futureDeposit(10n, 0n)],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not seed future shaping when the reserve gate fails", () => {
    const plan = planRebalance({
      outputSlots: 4,
      tip: TIP,
      ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
      ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
      depositCapacity: 1000n * CKB,
      readyDeposits: [],
      poolDepositsRest: NO_POOL_REST,
    });

    expect(plan).toMatchObject({ kind: "none" });
    expect(plan.diagnostics?.ring).toMatchObject({
      poolDepositCount: 0,
      canCreateRingInventory: false,
      shouldBootstrapRing: false,
    });
  });
});
