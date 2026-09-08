import type { ccc } from "@ckb-ccc/core";
import {
  type IckbDepositCell,
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "@ickb/sdk";

import type {
  RebalanceDiagnostics,
  RebalanceNoopReason,
  RebalancePlan,
  RebalanceWithdrawReason,
} from "./types.ts";

/**
 * Plans an iCKB withdrawal rebalance after matching.
 *
 * @remarks The plan names greedy candidates by maturity; how many of them one transaction
 * carries is decided by completion (decisions amendment 41). Ordinary excess withdrawals
 * preserve live ring anchors. Reserve recovery first tries the same ring-safe candidates,
 * then may use any ready deposit because restoring CKB now is the owning invariant.
 */
export function planRebalanceWithdrawal(options: {
  tip: ccc.ClientBlockHeader;
  ickbBalance: bigint;
  ckbBalance: bigint;
  ickbRefillThreshold: bigint;
  ckbRecoveryThreshold: bigint;
  poolDeposits: readonly IckbDepositCell[];
  readyDeposits: readonly IckbDepositCell[];
  diagnostics: RebalanceDiagnostics;
}): RebalancePlan {
  const {
    tip,
    ickbBalance,
    ckbBalance,
    ickbRefillThreshold,
    ckbRecoveryThreshold,
    poolDeposits,
    readyDeposits,
    diagnostics,
  } = options;
  const ringSurplus = ringSurplusDepositFilter(poolDeposits);
  if (ckbBalance < ckbRecoveryThreshold || ickbBalance < ickbRefillThreshold) {
    const surplus = selectReadyWithdrawalDeposits({
      readyDeposits,
      tip,
      maxAmount: ickbBalance,
      canSelectDeposit: ringSurplus,
    });
    const anyReady = selectReadyWithdrawalDeposits({
      readyDeposits,
      tip,
      maxAmount: ickbBalance,
    });
    if (surplus.length > 0) {
      return withdrawPlan("reserve_recovery", surplus, diagnostics, {
        ringSafe: true,
        fallback: anyReady,
      });
    }
    if (anyReady.length > 0) {
      return withdrawPlan("reserve_recovery", anyReady, diagnostics, { ringSafe: false });
    }
  }

  if (ickbBalance < ickbRefillThreshold) {
    return noRebalancePlan("low_ickb_ckb_reserve_unavailable", diagnostics);
  }

  const withdrawableIckb = ickbBalance - ickbRefillThreshold;
  if (withdrawableIckb <= 0n) {
    return noRebalancePlan("no_withdrawable_ickb", diagnostics);
  }

  const selection = selectReadyWithdrawalDeposits({
    readyDeposits,
    tip,
    maxAmount: withdrawableIckb,
    canSelectDeposit: ringSurplus,
  });
  if (selection.length > 0) {
    return withdrawPlan("excess_ickb_balance", selection, diagnostics, {
      ringSafe: true,
    });
  }
  return noRebalancePlan(
    noExcessWithdrawalReason(readyDeposits, ringSurplus),
    diagnostics,
  );
}

function noExcessWithdrawalReason(
  readyDeposits: readonly IckbDepositCell[],
  ringSurplus: (deposit: IckbDepositCell) => boolean,
): RebalanceNoopReason {
  if (readyDeposits.length === 0) {
    return "no_ready_withdrawal_selection";
  }
  return readyDeposits.some(ringSurplus)
    ? "ring_surplus_withdrawal_over_budget"
    : "no_ring_surplus_ready_deposits";
}

function noRebalancePlan(
  reason: RebalanceNoopReason,
  diagnostics: RebalanceDiagnostics,
): RebalancePlan {
  return { kind: "none", reason, diagnostics };
}

function withdrawPlan(
  reason: RebalanceWithdrawReason,
  deposits: IckbDepositCell[],
  diagnostics: RebalanceDiagnostics,
  options: { ringSafe: boolean; fallback?: IckbDepositCell[] },
): RebalancePlan {
  return {
    kind: "withdraw",
    reason,
    deposits,
    ringSafe: options.ringSafe,
    ...(options.fallback === undefined || options.fallback.length === 0
      ? {}
      : { fallback: options.fallback }),
    diagnostics,
  };
}
