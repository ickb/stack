import { ccc } from "@ckb-ccc/core";
import { CKB_RESERVE } from "../../../src/constants.ts";
import {
  ringSegmentIndex,
  ringSegments,
  ringSurplusDepositFilter,
  sortByMaturity,
} from "../../../src/conversion/withdrawal_ring.ts";
import type { IckbDepositCell } from "../../../src/logic.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";

/** The pool deposits the bot may request now: claim between fifteen minutes and an hour out. */
export const POOL_MIN_LOCK_UP = ccc.Epoch.from([0n, 1n, 16n]);
export const POOL_MAX_LOCK_UP = ccc.Epoch.from([0n, 4n, 16n]);

// The inventory band the pre-rewrite bot ran for a year: refill under 2,000 iCKB,
// withdraw above 120,000 keeping 20,000, so a refill lands far below the withdrawal
// line and a withdrawal keeps ten times the refill line (decisions amendment 52).
// The refill line must stay above the whole-only band of `CKB_MIN_MATCH_LOG_DEFAULT`
// (about 1,150 iCKB at 36), so a buyer the bot cannot complete always fires a refill.
export const ICKB_REFILL_BELOW = ICKB_DEPOSIT_CAP / 50n;
export const ICKB_RETAIN = ICKB_DEPOSIT_CAP / 5n;
export const ICKB_WITHDRAW_ABOVE = ICKB_DEPOSIT_CAP + ICKB_RETAIN;
/** Anchors may be withdrawn only when spendable CKB is below this fraction of a deposit. */
export const STRESS_DIVISOR = 5n;

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
  /** iCKB the bot holds after the match. */
  ickb: bigint;
  /** CKB available to the bot after the match. */
  ckb: bigint;
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
    /** Anchors were admitted because spendable CKB is below a fifth of a deposit. */
    stress: boolean;
  };
  ring: RingSummary;
}

/**
 * Deposit one cap-sized deposit when the ring's current window lacks coverage or the
 * bot holds under 2,000 iCKB, if 1,000 CKB remains after it. Withdraw ready surplus
 * deposits while the bot holds over 120,000 iCKB, keeping 20,000; anchors only under
 * stress (decisions amendment 52).
 */
export function planRebalance(input: RebalanceInput): RebalancePlan {
  const { tip, ickb, ckb, depositCost, poolDeposits } = input;
  const ring = ringCoverage(poolDeposits, tip);
  const plan: RebalancePlan = { ring: ring.summary };

  const depositReason = depositReasonFor(ickb, ring.needsSeed);
  if (depositReason !== undefined && ckb - depositCost >= CKB_RESERVE) {
    plan.deposit = { reason: depositReason };
  }

  if (ickb > ICKB_WITHDRAW_ABOVE) {
    const isSurplus = ringSurplusDepositFilter(poolDeposits);
    const stress = ckb - CKB_RESERVE < depositCost / STRESS_DIVISOR;
    const ready = sortByMaturity(
      poolDeposits.filter((deposit) => deposit.isReady),
      tip,
    );
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

function depositReasonFor(ickb: bigint, needsSeed: boolean): DepositReason | undefined {
  if (ickb < ICKB_REFILL_BELOW) {
    return "low_ickb";
  }
  return needsSeed ? "ring_coverage" : undefined;
}

/**
 * Whether the ring segment containing the tip lacks coverage: under half its equal share
 * of the pool's iCKB. The full public pool shapes the ring, not only ready deposits.
 */
export function ringCoverage(
  poolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): { needsSeed: boolean; summary: RingSummary } {
  const segments = ringSegments(poolDeposits);
  const targetSegmentIndex = ringSegmentIndex(tip.epoch, segments.length);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringSegmentIndex returns 0 <= index < segmentCount, and ringSegments always returns at least one segment.
  const target = segments[targetSegmentIndex]!;
  const totalPoolUdt = segments.reduce((sum, segment) => sum + segment.udtValue, 0n);
  return {
    needsSeed:
      poolDeposits.length === 0 ||
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
