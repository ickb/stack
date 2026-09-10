import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../../../src/core/index.ts";
import { ringSurplusDepositFilter } from "../../../src/core/withdrawal_selection.ts";
import { compareBigInt } from "../../../src/utils/index.ts";

import {
  CKB_RESERVE,
  ICKB_REFILL_BELOW,
  ICKB_RETAIN,
  ICKB_WITHDRAW_ABOVE,
  STRESS_DIVISOR,
} from "./policy/constants.ts";
import { ringCoverage, type RingSummary } from "./policy/ring.ts";

export { POOL_MAX_LOCK_UP, POOL_MIN_LOCK_UP } from "./policy/constants.ts";
export type { RingSummary } from "./policy/ring.ts";

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
    const ready = poolDeposits
      .filter((deposit) => deposit.isReady)
      .toSorted((left, right) =>
        compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
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
