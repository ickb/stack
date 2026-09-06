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
} from "./fixtures/policy.ts";

describe(PLAN_REBALANCE_SUITE, () => {
  it("seeds ring inventory when one more deposit would cross the withdrawal floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP + 1n,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: NO_POOL_REST,
      }),
    ).toMatchObject({ kind: "deposit", reason: "ring_inventory", quantity: 1 });
  });

  it("keeps direct seeding when future crowding has only deposit output slots", () => {
    expect(
      planRebalance({
        outputSlots: 3,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(5n), futureDeposit(6n), futureDeposit(9n)],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });

  it("keeps direct seeding when removing a future source would leave the source segment below the preservation floor", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(5n, 50n),
          futureDeposit(6n, 50n),
          futureDeposit(9n, 200n),
          futureDeposit(13n, 200n),
        ],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });

  it("keeps direct seeding when density improvement would be too small", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(1n, 10n),
          futureDeposit(4n),
          futureDeposit(4n),
          futureDeposit(4n),
          futureDeposit(5n),
          futureDeposit(5n),
          futureDeposit(9n, 10n),
        ],
      }),
    ).toMatchObject({ kind: "deposit", quantity: 1 });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("returns none, not a withdrawal, when dust crowds the future pool without deposit budget", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(5n, 1n),
          futureDeposit(6n, 1n),
          futureDeposit(9n),
        ],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does not reserve withdrawals when public drain leaves the future target under-covered", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(5n), futureDeposit(9n, 1n), futureDeposit(13n)],
      }),
    ).toMatchObject({ kind: "none" });
  });
});

describe(PLAN_REBALANCE_SUITE, () => {
  it("does not expand future horizon or remove a farther source", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(5n),
          futureDeposit(6n),
          futureDeposit(9n),
          futureDeposit(10000n),
        ],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("returns none when a raced future-removal source disappears", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 1000n * CKB + CKB_RESERVE - 1n,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [futureDeposit(9n)],
      }),
    ).toMatchObject({ kind: "none" });
  });

  it("does nothing instead of withdrawing for cosmetic future smoothing", () => {
    expect(
      planRebalance({
        outputSlots: 4,
        tip: TIP,
        ickbBalance: TARGET_ICKB_BALANCE - ICKB_DEPOSIT_CAP,
        ckbBalance: 2000n * CKB,
        depositCapacity: 1000n * CKB,
        readyDeposits: [],
        poolDepositsRest: [
          futureDeposit(1n),
          futureDeposit(4n),
          futureDeposit(8n),
          futureDeposit(12n),
        ],
      }),
    ).toMatchObject({ kind: "none" });
  });
});
