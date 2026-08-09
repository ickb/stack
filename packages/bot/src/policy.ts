import { CKB_RESERVE } from "./policy/constants.ts";
import { canFundDirectDeposit, evaluateRingCoverage } from "./policy/ring.ts";
import type { PlanRebalanceOptions, RebalancePlan } from "./policy/types.ts";
import { planRebalanceWithdrawal } from "./policy/withdrawal.ts";

export {
  CKB,
  CKB_RESERVE,
  POOL_MAX_LOCK_UP,
  POOL_MIN_LOCK_UP,
} from "./policy/constants.ts";
export type {
  PlanRebalanceOptions,
  RebalanceDiagnostics,
  RebalancePlan,
  RingSegmentDiagnostics,
} from "./policy/types.ts";

/**
 * Chooses at most one deposit or withdrawal-request action for bot inventory and reserve policy.
 *
 * @remarks Reserve recovery can withdraw any ready deposit when ring-surplus
 * selection cannot recover CKB; normal excess withdrawals preserve live ring
 * anchors.
 */
export function planRebalance(options: PlanRebalanceOptions): RebalancePlan {
  const {
    outputSlots,
    tip,
    ickbBalance,
    ckbBalance,
    directDepositCapacity,
    directDepositFeeHeadroom = 0n,
    ickbRefillThreshold = 0n,
    ckbRecoveryThreshold = CKB_RESERVE,
    poolDeposits,
    readyDeposits,
  } = options;

  if (outputSlots < 2) {
    return { kind: "none", reason: "insufficient_output_slots" };
  }

  const needsIckbRefill = ickbBalance < ickbRefillThreshold;
  if (
    needsIckbRefill &&
    canFundDirectDeposit(ckbBalance, directDepositCapacity, directDepositFeeHeadroom)
  ) {
    return { kind: "deposit", reason: "low_ickb_balance", quantity: 1 };
  }

  const ringCoverage = evaluateRingCoverage({
    poolDeposits,
    tip,
    ickbBalance,
    ckbBalance,
    directDepositCapacity,
    directDepositFeeHeadroom,
    ickbRefillThreshold,
  });
  if (ringCoverage.canSeed) {
    return {
      kind: "deposit",
      reason: "ring_inventory",
      quantity: 1,
      diagnostics: ringCoverage.diagnostics,
    };
  }
  return planRebalanceWithdrawal({
    outputSlots,
    tip,
    ickbBalance,
    ckbBalance,
    ickbRefillThreshold,
    ckbRecoveryThreshold,
    poolDeposits,
    readyDeposits,
    diagnostics: ringCoverage.diagnostics,
  });
}
