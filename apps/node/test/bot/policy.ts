import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "@ickb/sdk";

import { headerLike } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { planRebalance, type RebalanceInput } from "../../src/bot/policy.ts";
import {
  CKB_RESERVE,
  ICKB_REFILL_BELOW,
  ICKB_RETAIN,
  ICKB_WITHDRAW_ABOVE,
} from "../../src/bot/policy/constants.ts";
import { readyDeposit } from "./fixtures/bot.ts";

const TIP = headerLike({ epoch: [0n, 0n, 1n], timestamp: 0n });
const DEPOSIT_COST = ccc.fixedPointFrom(100_300);
const MINUTE = 60n * 1000n;

function input(overrides: Partial<RebalanceInput> = {}): RebalanceInput {
  return {
    tip: TIP,
    ickb: ccc.fixedPointFrom(50_000),
    ckb: ccc.fixedPointFrom(500_000),
    depositCost: DEPOSIT_COST,
    poolDeposits: coveredPool(),
    ...overrides,
  };
}

/** Ready deposits spread over the ring so the target segment holds its share. */
function coveredPool(): IckbDepositCell[] {
  return [
    readyDeposit("a1", ICKB_DEPOSIT_CAP, 0n),
    readyDeposit("a2", ICKB_DEPOSIT_CAP, 20n * MINUTE),
  ];
}

describe("planRebalance deposit", () => {
  it("refills below the refill line when the reserve survives the deposit", () => {
    const plan = planRebalance(input({ ickb: ICKB_REFILL_BELOW - 1n }));

    expect(plan.deposit).toEqual({ reason: "low_ickb" });
    expect(plan.withdrawal).toBeUndefined();
  });

  it("does not deposit when the reserve would not survive it", () => {
    const plan = planRebalance(input({ ickb: 0n, ckb: DEPOSIT_COST + CKB_RESERVE - 1n }));

    expect(plan.deposit).toBeUndefined();
  });

  it("seeds an empty or under-covered ring window", () => {
    expect(planRebalance(input({ poolDeposits: [] })).deposit).toEqual({
      reason: "ring_coverage",
    });
    // One deposit at the tip window and four elsewhere: the target holds under half its share.
    const whales = ["b1", "b2", "b3", "b4"].map((byte) =>
      readyDeposit(byte, 9n * ICKB_DEPOSIT_CAP, 60n * MINUTE),
    );
    const plan = planRebalance(
      input({ poolDeposits: [readyDeposit("b0", ICKB_DEPOSIT_CAP, 0n), ...whales] }),
    );

    expect(plan.deposit).toEqual({ reason: "ring_coverage" });
    expect(plan.ring).toMatchObject({
      poolDepositCount: 5,
      targetUdtValue: ICKB_DEPOSIT_CAP,
    });
  });

  it("does nothing inside the band with a covered ring", () => {
    const plan = planRebalance(input());

    expect(plan).toEqual({ ring: plan.ring });
  });
});

describe("planRebalance withdrawal", () => {
  it("names ready surplus deposits by maturity under the retention budget", () => {
    // Four segments of 45 epochs: the first three deposits share one, the last has its own.
    const late = readyDeposit("c3", ICKB_DEPOSIT_CAP, 100n * MINUTE);
    const early = readyDeposit("c1", ICKB_DEPOSIT_CAP, 0n);
    const anchorMate = readyDeposit("c2", ICKB_DEPOSIT_CAP + 1n, 0n);
    const notReady = readyDeposit("c4", ICKB_DEPOSIT_CAP, 5n * MINUTE, {
      isReady: false,
    });
    const ickb = ICKB_WITHDRAW_ABOVE + 1n;

    const plan = planRebalance(
      input({ ickb, poolDeposits: [late, early, anchorMate, notReady] }),
    );

    // A segment's anchor is its not-ready deposit, else its largest; the rest are surplus.
    expect(plan.withdrawal).toEqual({
      candidates: [early, anchorMate],
      budget: ickb - ICKB_RETAIN,
      stress: false,
    });
  });

  it("admits anchors after the surplus only under stress", () => {
    const surplus = readyDeposit("d1", ICKB_DEPOSIT_CAP, 0n);
    const anchor = readyDeposit("d2", ICKB_DEPOSIT_CAP + 1n, 0n);
    const stressed = input({
      ickb: ICKB_WITHDRAW_ABOVE + 1n,
      ckb: CKB_RESERVE + DEPOSIT_COST / 5n - 1n,
      poolDeposits: [anchor, surplus],
    });

    expect(planRebalance(stressed).withdrawal).toMatchObject({
      candidates: [surplus, anchor],
      stress: true,
    });
    expect(
      planRebalance({ ...stressed, ckb: CKB_RESERVE + DEPOSIT_COST / 5n }).withdrawal,
    ).toMatchObject({ candidates: [surplus], stress: false });
  });

  it("returns both moves when coverage and excess apply, and none without ready deposits", () => {
    const both = planRebalance(
      input({
        ickb: ICKB_WITHDRAW_ABOVE + 1n,
        poolDeposits: [
          readyDeposit("e1", ICKB_DEPOSIT_CAP, 0n),
          readyDeposit("e2", ICKB_DEPOSIT_CAP, 0n),
          readyDeposit("e3", 30n * ICKB_DEPOSIT_CAP, 60n * MINUTE),
        ],
      }),
    );
    expect(both.deposit).toEqual({ reason: "ring_coverage" });
    expect(both.withdrawal?.candidates).toHaveLength(1);

    const none = planRebalance(
      input({
        ickb: ICKB_WITHDRAW_ABOVE + 1n,
        poolDeposits: [readyDeposit("e4", ICKB_DEPOSIT_CAP, 0n, { isReady: false })],
      }),
    );
    expect(none.withdrawal).toBeUndefined();
  });
});
