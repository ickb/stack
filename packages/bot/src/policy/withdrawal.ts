import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import {
  ringRequiredLiveDepositFor,
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "@ickb/sdk";
import type {
  RebalanceDiagnostics,
  RebalanceNoopReason,
  RebalancePlan,
  RebalanceWithdrawReason,
} from "./types.ts";

const OUTPUTS_PER_REBALANCE_ACTION = 2;
const MAX_WITHDRAWAL_REQUESTS = 30;

/**
 * Plans an iCKB withdrawal rebalance after matching and output-slot reservation.
 *
 * @remarks Ordinary excess withdrawals preserve live ring anchors. Reserve
 * recovery first tries the same ring-safe path, then may use any ready deposit
 * because restoring CKB now is the owning invariant.
 */
export function planRebalanceWithdrawal(options: {
  outputSlots: number;
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
    outputSlots,
    tip,
    ickbBalance,
    ckbBalance,
    ickbRefillThreshold,
    ckbRecoveryThreshold,
    poolDeposits,
    readyDeposits,
    diagnostics,
  } = options;
  const withdrawalLimit = Math.min(
    MAX_WITHDRAWAL_REQUESTS,
    Math.floor(outputSlots / OUTPUTS_PER_REBALANCE_ACTION),
  );
  if (ckbBalance < ckbRecoveryThreshold || ickbBalance < ickbRefillThreshold) {
    const recovery = planReserveRecovery({
      withdrawalLimit,
      tip,
      excessIckb: ickbBalance,
      poolDeposits,
      readyDeposits,
      diagnostics,
    });
    if (recovery.kind === "withdraw") {
      return recovery;
    }
  }

  if (ickbBalance < ickbRefillThreshold) {
    return noRebalancePlan("low_ickb_ckb_reserve_unavailable", diagnostics);
  }

  const withdrawableIckb = ickbBalance - ickbRefillThreshold;
  if (withdrawableIckb <= 0n) {
    return noRebalancePlan("no_withdrawable_ickb", diagnostics);
  }

  return planExcessIckbWithdrawal({
    readyDeposits,
    tip,
    withdrawableIckb,
    withdrawalLimit,
    poolDeposits,
    diagnostics,
  });
}

function planReserveRecovery(options: {
  withdrawalLimit: number;
  tip: ccc.ClientBlockHeader;
  excessIckb: bigint;
  poolDeposits: readonly IckbDepositCell[];
  readyDeposits: readonly IckbDepositCell[];
  diagnostics: RebalanceDiagnostics;
}): RebalancePlan {
  const { withdrawalLimit, tip, excessIckb, poolDeposits, readyDeposits, diagnostics } =
    options;
  const selection = selectPoolRebalancingDeposits({
    readyDeposits,
    tip,
    maxAmount: excessIckb,
    limit: withdrawalLimit,
    ringSurplus: ringSurplusDepositFilter(poolDeposits),
    requiredLiveDepositFor: ringRequiredLiveDepositFor(poolDeposits),
  });
  if (selection.deposits.length > 0) {
    return withdrawPlan("reserve_recovery", selection, diagnostics);
  }

  // Reserve recovery is allowed to fall back to any ready deposit because its
  // goal is restoring CKB now; normal excess withdrawals keep ring anchors live.
  const reserveRecovery = selectPoolRebalancingDeposits({
    readyDeposits,
    tip,
    maxAmount: excessIckb,
    limit: withdrawalLimit,
    ringSurplus: () => true,
    requiredLiveDepositFor: undefined,
  });
  if (reserveRecovery.deposits.length > 0) {
    return withdrawPlan("reserve_recovery", reserveRecovery, diagnostics);
  }

  return {
    kind: "none",
    reason: "no_ready_withdrawal_selection",
    diagnostics,
  };
}

function planExcessIckbWithdrawal({
  readyDeposits,
  tip,
  withdrawableIckb,
  withdrawalLimit,
  poolDeposits,
  diagnostics,
}: {
  readyDeposits: readonly IckbDepositCell[];
  tip: ccc.ClientBlockHeader;
  withdrawableIckb: bigint;
  withdrawalLimit: number;
  poolDeposits: readonly IckbDepositCell[];
  diagnostics: RebalanceDiagnostics;
}): RebalancePlan {
  const ringSurplus = ringSurplusDepositFilter(poolDeposits);
  const selection = selectPoolRebalancingDeposits({
    readyDeposits,
    tip,
    maxAmount: withdrawableIckb,
    limit: withdrawalLimit,
    ringSurplus,
    requiredLiveDepositFor: ringRequiredLiveDepositFor(poolDeposits),
  });
  if (selection.deposits.length > 0) {
    return withdrawPlan("excess_ickb_balance", selection, diagnostics);
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
  return {
    kind: "none",
    reason,
    diagnostics,
  };
}

function withdrawPlan(
  reason: RebalanceWithdrawReason,
  selection: {
    deposits: IckbDepositCell[];
    requiredLiveDeposits: IckbDepositCell[];
  },
  diagnostics: RebalanceDiagnostics,
): RebalancePlan {
  return {
    kind: "withdraw",
    reason,
    deposits: selection.deposits,
    diagnostics,
    ...(selection.requiredLiveDeposits.length > 0
      ? { requiredLiveDeposits: selection.requiredLiveDeposits }
      : {}),
  };
}

function selectPoolRebalancingDeposits({
  readyDeposits,
  tip,
  maxAmount,
  limit,
  ringSurplus,
  requiredLiveDepositFor,
}: {
  readyDeposits: readonly IckbDepositCell[];
  tip: ccc.ClientBlockHeader;
  maxAmount: bigint;
  limit: number;
  ringSurplus: (deposit: IckbDepositCell) => boolean;
  requiredLiveDepositFor:
    ((deposit: IckbDepositCell) => IckbDepositCell | undefined) | undefined;
}): {
  deposits: IckbDepositCell[];
  requiredLiveDeposits: IckbDepositCell[];
} {
  return selectReadyWithdrawalDeposits({
    readyDeposits,
    tip,
    maxAmount,
    maxCount: limit,
    canSelectDeposit: ringSurplus,
    ...(requiredLiveDepositFor === undefined ? {} : { requiredLiveDepositFor }),
  });
}
