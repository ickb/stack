import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";

/** Inputs for choosing the bot's post-match rebalance action. */
export interface PlanRebalanceOptions {
  /** Remaining output capacity after planned match/collect actions. */
  outputSlots: number;

  /** Sampled tip used for maturity and ring calculations. */
  tip: ccc.ClientBlockHeader;

  /** Post-match available iCKB balance. */
  ickbBalance: bigint;

  /** Post-match available CKB balance. */
  ckbBalance: bigint;

  /** Capacity required for one direct deposit. */
  directDepositCapacity: bigint;

  /** Extra CKB headroom reserved for direct-deposit fees. */
  directDepositFeeHeadroom?: bigint;

  /** Minimum iCKB balance before the bot may spend iCKB on withdrawals. */
  ickbRefillThreshold?: bigint;

  /** CKB threshold below which reserve recovery may spend iCKB. */
  ckbRecoveryThreshold?: bigint;

  /** Full public pool snapshot used for ring coverage and anchor decisions. */
  poolDeposits: readonly IckbDepositCell[];

  /** Ready deposits available for withdrawal selection. */
  readyDeposits: readonly IckbDepositCell[];
}

/**
 * Rebalance action chosen after match planning reserves output slots.
 */
export type RebalancePlan =
  | {
      kind: "none";
      reason: RebalanceNoopReason;
      diagnostics?: RebalanceDiagnostics;
    }
  | {
      kind: "deposit";
      reason: RebalanceDepositReason;
      quantity: 1;
      diagnostics?: RebalanceDiagnostics;
    }
  | {
      kind: "withdraw";
      reason: RebalanceWithdrawReason;
      deposits: IckbDepositCell[];
      requiredLiveDeposits?: IckbDepositCell[];
      diagnostics?: RebalanceDiagnostics;
    };

type RebalanceDepositReason = "low_ickb_balance" | "ring_inventory";
export type RebalanceWithdrawReason = "excess_ickb_balance" | "reserve_recovery";

export type RebalanceNoopReason =
  | "insufficient_output_slots"
  | "low_ickb_ckb_reserve_unavailable"
  | "no_withdrawable_ickb"
  | "no_ring_surplus_ready_deposits"
  | "ring_surplus_withdrawal_over_budget"
  | "no_ready_withdrawal_selection";

export interface RebalanceDiagnostics {
  ring?: RingDiagnostics;
}

/**
 * Public diagnostic snapshot for ring-shaped pool inventory decisions.
 */
export interface RingDiagnostics {
  poolDepositCount: number;
  canCreateRingInventory: boolean;
  shouldBootstrapRing: boolean;
  ringLength: bigint;
  segmentCount: number;
  targetSegmentIndex: number;
  targetSegmentUdtValue: bigint;
  totalPoolUdt: bigint;
  depositsShareOneSegment: boolean;
  segments: RingSegmentDiagnostics[];
}

export interface RingSegmentDiagnostics {
  index: number;
  depositCount: number;
  udtValue: bigint;
  isTarget: boolean;
  protectedDepositCount: number;
  protectedUdtValue: bigint;
  protectedOutPoints: string[];
  surplusDepositCount: number;
  surplusUdtValue: bigint;
  surplusOutPoints: string[];
}
