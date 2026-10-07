import { ccc } from "@ckb-ccc/core";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { receiptPhase2Capacity, type IckbDepositCell } from "../../../src/logic.ts";
import { CKB_MIN_MATCH_LOG_DEFAULT } from "../../../src/order/info.ts";
import {
  convert,
  ICKB_DEPOSIT_CAP,
  ickbAccountingRatio,
  ickbExchangeRatio,
} from "../../../src/udt.ts";

import { headerLike } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { CKB_RESERVE } from "../../../src/constants.ts";
import {
  ICKB_REFILL_BELOW,
  ICKB_RETAIN,
  ICKB_WITHDRAW_ABOVE,
  planRebalance,
  type RebalanceInput,
} from "../../src/bot/policy.ts";
import { BOT_TIP, readyDeposit } from "./fixtures/bot.ts";

const TIP = BOT_TIP;
const DEPOSIT_COST = ccc.fixedPointFrom(100_300);
/** Minutes in the nominal epoch: a whole number of these out is another ring segment. */
const EPOCH_MINUTES = 240n;

function input(overrides: Partial<RebalanceInput> = {}): RebalanceInput {
  return {
    tip: TIP,
    lockUp: BOT_LOCK_UP,
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
    readyDeposit("a1", ICKB_DEPOSIT_CAP),
    readyDeposit("a2", ICKB_DEPOSIT_CAP, 40n),
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
    // Half a cap at the tip window and four whales elsewhere: 36.5 caps make 32 segments,
    // so the target holds under half its share of about 1.14 caps.
    const whales = ["b1", "b2", "b3", "b4"].map((byte) =>
      readyDeposit(byte, 9n * ICKB_DEPOSIT_CAP, 60n * EPOCH_MINUTES),
    );
    const plan = planRebalance(
      input({ poolDeposits: [readyDeposit("b0", ICKB_DEPOSIT_CAP / 2n), ...whales] }),
    );

    expect(plan.deposit).toEqual({ reason: "ring_coverage" });
    expect(plan.ring).toMatchObject({
      poolDepositCount: 5,
      segmentCount: 32,
      targetUdtValue: ICKB_DEPOSIT_CAP / 2n,
    });
  });

  it("seeds a pool that holds only zero-value deposits", () => {
    const plan = planRebalance(input({ poolDeposits: [readyDeposit("f0", 0n)] }));

    expect(plan.deposit).toEqual({ reason: "ring_coverage" });
    expect(plan.ring).toMatchObject({ poolDepositCount: 1, segmentCount: 1 });
  });

  it("does nothing inside the band with a covered ring", () => {
    const plan = planRebalance(input());

    expect(plan).toEqual({ ring: plan.ring });
  });
});

describe("planRebalance withdrawal", () => {
  it("names ready surplus deposits by claim under the retention budget", () => {
    // Four segments of 45 epochs: the first three deposits share one, the last has its own.
    // A claim fifteen minutes out is under the bot's twenty-minute floor: not ready.
    const late = readyDeposit("c3", ICKB_DEPOSIT_CAP, 100n * EPOCH_MINUTES);
    const early = readyDeposit("c1", ICKB_DEPOSIT_CAP);
    const anchorMate = readyDeposit("c2", ICKB_DEPOSIT_CAP + 1n);
    const notReady = readyDeposit("c4", ICKB_DEPOSIT_CAP, 15n);
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
    const surplus = readyDeposit("d1", ICKB_DEPOSIT_CAP);
    const anchor = readyDeposit("d2", ICKB_DEPOSIT_CAP + 1n);
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
        // 31.5 caps make 16 segments; the two quarter-caps at the tip hold under half its share.
        poolDeposits: [
          readyDeposit("e1", ICKB_DEPOSIT_CAP / 4n),
          readyDeposit("e2", ICKB_DEPOSIT_CAP / 4n),
          readyDeposit("e3", 31n * ICKB_DEPOSIT_CAP, 60n * EPOCH_MINUTES),
        ],
      }),
    );
    expect(both.deposit).toEqual({ reason: "ring_coverage" });
    expect(both.withdrawal?.candidates).toHaveLength(1);

    const none = planRebalance(
      input({
        ickb: ICKB_WITHDRAW_ABOVE + 1n,
        poolDeposits: [readyDeposit("e4", ICKB_DEPOSIT_CAP, 15n)],
      }),
    );
    expect(none.withdrawal).toBeUndefined();
  });
});

const CKB = ccc.fixedPointFrom(1);
const AR_0 = 10_000_000_000_000_000n;

// Adopted from the fable51, fable5, and grok46 policy audits: the facts the thresholds rest on.
describe("policy arithmetic", () => {
  it("prices a cap-sized deposit and a secp256k1 receipt at the tip", () => {
    const secpLock = ccc.Script.from({
      codeHash: `0x${"9b".repeat(32)}`,
      hashType: "type",
      args: `0x${"11".repeat(20)}`,
    });
    const header = headerLike({ dao: { c: 0n, ar: (AR_0 * 11n) / 10n, s: 0n, u: 0n } });

    expect(convert(false, ICKB_DEPOSIT_CAP, ickbExchangeRatio(header))).toBe(
      110_082n * CKB,
    );
    expect(receiptPhase2Capacity(secpLock)).toBe(208n * CKB);
  });

  it("refills above twice the default minimum match, so a buyer too small to split triggers a refill", () => {
    // At the genesis AR an iCKB costs the least CKB, so the minimum converts to the most iCKB.
    const header = headerLike({ dao: { c: 0n, ar: AR_0, s: 0n, u: 0n } });
    const twiceMinimum = 2n << BigInt(CKB_MIN_MATCH_LOG_DEFAULT);

    expect(convert(true, twiceMinimum, ickbExchangeRatio(header))).toBeLessThan(
      ICKB_REFILL_BELOW,
    );
  });

  it.each([AR_0, (15n * AR_0) / 10n, (3n * AR_0) / 2n + 12345n])(
    "a refill lands below the withdrawal line because a cap-sized deposit mints at most the cap at ar=%s",
    (ar) => {
      const header = headerLike({ dao: { c: 0n, ar, s: 0n, u: 0n } });
      const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, ickbExchangeRatio(header));
      // 82 CKB is the occupied capacity of a standard iCKB deposit cell.
      const minted = convert(
        true,
        depositCapacity - 82n * CKB,
        ickbAccountingRatio(header),
      );

      expect(minted).toBeLessThanOrEqual(ICKB_DEPOSIT_CAP);
      expect(ICKB_REFILL_BELOW - 1n + minted).toBeLessThan(ICKB_WITHDRAW_ABOVE);
    },
  );
});

/** A small deterministic generator, so the property is reproducible from its seed. */
function* pseudoRandom(seed: bigint): Generator<bigint, never, void> {
  let state = seed;
  for (;;) {
    state =
      (state * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % (1n << 64n);
    yield state >> 11n;
  }
}

// The self-recovery invariant: an account funded to the recommended 2.2 deposits never sits
// below the refill line with nothing to do. Pending withdrawals only add CKB on their way
// back, and the planner never sees them, so the property is checked with nothing pending.
describe("self-recovery property", () => {
  it("below the refill line, a funded account with nothing pending can deposit", () => {
    const random = pseudoRandom(20_260_908n);
    const funding = (22n * DEPOSIT_COST) / 10n;
    let checked = 0;
    for (let round = 0; round < 2000; round += 1) {
      const ickb = random.next().value % ICKB_REFILL_BELOW;
      const ckb = random.next().value % (4n * DEPOSIT_COST);
      if (ckb + ickb < funding) {
        continue;
      }
      checked += 1;
      expect(planRebalance(input({ ickb, ckb })).deposit).toEqual({ reason: "low_ickb" });
    }
    expect(checked).toBeGreaterThan(500);
  });
});
