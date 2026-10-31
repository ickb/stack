import { ccc } from "@ckb-ccc/core";
import {
  ringSegmentIndex,
  ringSegments,
  ringSurplusDepositFilter,
  sortByClaim,
} from "../../../src/conversion/withdrawal_ring.ts";
import type { LockUpPolicy } from "../../../src/dao.ts";
import { readyDeposits, type IckbDepositCell } from "../../../src/logic.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { CKB_RESERVE } from "../shared/reserve.ts";

// The inventory band the pre-rewrite bot ran for a year: refill under 2,000 iCKB,
// withdraw above 120,000 keeping 20,000, so a refill lands far below the withdrawal
// line and a withdrawal keeps ten times the refill line.
// The refill line must exceed twice `CKB_MIN_MATCH_LOG_DEFAULT`'s minimum, converted to
// iCKB, so a buyer that is too small to split cannot wait above the refill threshold.
export const ICKB_REFILL_BELOW = ICKB_DEPOSIT_CAP / 50n;
export const ICKB_RETAIN = ICKB_DEPOSIT_CAP / 5n;
export const ICKB_WITHDRAW_ABOVE = ICKB_DEPOSIT_CAP + ICKB_RETAIN;

/** Compact evidence of the pool ring the policy evaluated, as the journal carries it. */
export interface RingSummary {
  poolDepositCount: number;
  segmentCount: number;
  targetSegmentIndex: number;
  targetUdtValue: bigint;
  totalPoolUdt: bigint;
}

/** Post-match balances and the pool the rebalance decision reads. */
export interface RebalanceInput {
  tip: ccc.ClientBlockHeader;
  /** The bot's withdrawal timing rules, `BOT_LOCK_UP`, as the state read carried them. */
  lockUp: LockUpPolicy;
  /** iCKB the bot holds after the match. */
  ickb: bigint;
  /** CKB available to the bot after the match. */
  ckb: bigint;
  /** CKB locked in the bot's withdrawal requests that are not ready yet. */
  pendingCkb: bigint;
  /** Capacity of one cap-sized deposit plus its receipt. */
  depositCost: bigint;
  poolDeposits: readonly IckbDepositCell[];
}

export type DepositReason = "low_ickb" | "ring_coverage";

/**
 * The two rebalance moves a turn may attempt, never both in one transaction: the runtime
 * tries the deposit first and, when it cannot complete, the withdrawal candidates.
 */
export interface RebalancePlan {
  deposit?: { reason: DepositReason };
  withdrawal?: {
    /** Ready deposits in maturity order, surplus first, then anchors under stress. */
    candidates: IckbDepositCell[];
    /** iCKB the requests may consume: the balance minus the retained buffer. */
    budget: bigint;
    /** Anchors were admitted because the bot's CKB, in hand or in flight, reserve included, is under one deposit's cost. */
    stress: boolean;
  };
  ring: RingSummary;
}

/** CKB a match or a deposit may spend: what is available above the reserve. */
export function spendableCkb(ckb: bigint): bigint {
  return ccc.numMax(0n, ckb - CKB_RESERVE);
}

/**
 * Refill under 2,000 iCKB keeping the reserve; seed the ring keeping one deposit more, the
 * line stress restores, measured on total CKB. Withdraw ready surplus while over 120,000 iCKB, keeping 20,000;
 * anchors too under stress. Rationale in node/docs/policy.md.
 */
export function planRebalance(input: RebalanceInput): RebalancePlan {
  const { tip, lockUp, ickb, ckb, pendingCkb, depositCost, poolDeposits } = input;
  const ring = ringCoverage(poolDeposits, tip);
  const plan: RebalancePlan = { ring: ring.summary };

  const spendable = spendableCkb(ckb);
  if (ickb < ICKB_REFILL_BELOW && spendable >= depositCost) {
    plan.deposit = { reason: "low_ickb" };
  } else if (ring.needsSeed && spendable >= 2n * depositCost) {
    plan.deposit = { reason: "ring_coverage" };
  }

  if (ickb > ICKB_WITHDRAW_ABOVE) {
    const ready = sortByClaim(readyDeposits(poolDeposits, tip, lockUp));
    const isSurplus = ringSurplusDepositFilter(poolDeposits, ready);
    // Total CKB, reserve included: a matured cap anchor returns about the deposit's
    // capacity, under its cost by the receipt and the fees, so a line beyond the reserve
    // was never restored by one anchor and each dip took a second. The reserve is the slack.
    const stress = ckb + pendingCkb < depositCost;
    const candidates = [
      ...ready.filter(isSurplus),
      ...(stress ? ready.filter((deposit) => !isSurplus(deposit)) : []),
    ];
    if (candidates.length > 0) {
      plan.withdrawal = { candidates, budget: ickb - ICKB_RETAIN, stress };
    }
  }
  return plan;
}

/**
 * Whether the ring segment containing the tip lacks coverage: under half its equal share
 * of the pool's iCKB. The full public pool shapes the ring, not only ready deposits.
 */
function ringCoverage(
  poolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): { needsSeed: boolean; summary: RingSummary } {
  const segments = ringSegments(poolDeposits);
  const targetSegmentIndex = ringSegmentIndex(tip.epoch, segments.length);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringSegmentIndex returns 0 <= index < segmentCount, and ringSegments always returns at least one segment.
  const target = segments[targetSegmentIndex]!;
  const totalPoolUdt = segments.reduce((sum, segment) => sum + segment.udtValue, 0n);
  return {
    // Pool value, not deposit count: a pool holding only zero-value deposits still needs
    // seeding, and the inequality below is false when every term is zero.
    needsSeed:
      totalPoolUdt === 0n ||
      2n * target.udtValue * BigInt(segments.length) < totalPoolUdt,
    summary: {
      poolDepositCount: poolDeposits.length,
      segmentCount: segments.length,
      targetSegmentIndex,
      targetUdtValue: target.udtValue,
      totalPoolUdt,
    },
  };
}
