import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell, ReceiptCell, WithdrawalGroup } from "@ickb/core";
import type { SupportedChain } from "@ickb/node-utils";
import type { MatchDiagnostics, OrderCell, OrderGroup } from "@ickb/order";
import type { getConfig, IckbSdk, SystemState } from "@ickb/sdk";
import type { RebalanceDiagnostics, RebalancePlan } from "../policy.ts";

/** Runtime dependencies used by each bot loop iteration. */
export interface Runtime {
  /** Configured public chain. */
  chain: SupportedChain;

  /** CCC client for the configured chain. */
  client: ccc.Client;

  /** Private-key signer; signing is its only secret-bearing purpose. */
  signer: ccc.SignerCkbPrivateKey;

  /** SDK instance for state scans and transaction completion. */
  sdk: IckbSdk;

  /** Lower-level managers from the selected deployment config. */
  managers: ReturnType<typeof getConfig>["managers"];

  /** Primary lock controlled by the signer. */
  primaryLock: ccc.Script;
}

/** Snapshot of bot-owned and public state used for one planning attempt. */
export interface BotState {
  /** Sampled public L1 state. */
  system: SystemState;

  /** User-owned order groups. */
  userOrders: OrderGroup[];

  /** Public market orders eligible for matching. */
  marketOrders: OrderCell[];

  /** User receipt cells ready for deposit completion. */
  receipts: ReceiptCell[];

  /** User withdrawal groups ready for withdrawal completion. */
  readyWithdrawals: WithdrawalGroup[];

  /** User withdrawal groups that are not ready yet. */
  notReadyWithdrawals: WithdrawalGroup[];

  /** Full public pool deposit snapshot. */
  poolDeposits: IckbDepositCell[];

  /** Ready public pool deposits available as withdrawal candidates. */
  readyPoolDeposits: IckbDepositCell[];

  /** Spendable CKB after projected availability rules. */
  availableCkbBalance: bigint;

  /** Spendable iCKB after projected availability rules. */
  availableIckbBalance: bigint;

  /** CKB represented by pending or otherwise unavailable paths. */
  unavailableCkbBalance: bigint;

  /** Total projected CKB balance. */
  totalCkbBalance: bigint;

  /** Capacity used for one direct deposit output. */
  depositCapacity: bigint;

  /** Minimum CKB-equivalent capital required before the bot acts. */
  minCkbBalance: bigint;
}

/** Counts of actions selected for a candidate transaction. */
export interface BotActions {
  collectedOrders: number;
  completedDeposits: number;
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  withdrawals: number;
}

export type BuildTransactionSkipReason =
  "no_actions" | "match_value_not_above_fee" | "output_limit" | "post_tx_ckb_reserve";

export type BotDecisionSkipReason = BuildTransactionSkipReason | "capital_below_minimum";

export type BotMatchReason =
  | "matched"
  | "no_market_orders"
  | "no_matchable_orders"
  | "insufficient_allowance"
  | "no_viable_candidates"
  | "max_partials"
  | "no_positive_gain";

type BotRebalanceReason = RebalancePlan["reason"];

/**
 * Bot transaction-build outcome with the decision transcript used for logs and events.
 */
export type BuildTransactionResult =
  | {
      kind: "built";
      tx: ccc.Transaction;
      actions: BotActions;
      decision: BotDecisionTranscript;
    }
  | {
      kind: "skipped";
      reason: BuildTransactionSkipReason;
      actions: BotActions;
      decision: BotDecisionTranscript;
    };

export interface CandidateTransaction {
  tx: ccc.Transaction;
  actions: BotActions;
  rebalance: RebalancePlan;
}

/**
 * Structured evidence for one bot planning attempt.
 */
export interface BotDecisionTranscript {
  chainTip: {
    blockNumber: bigint;
    blockHash: ccc.Hex;
    timestamp: bigint;
    epoch: {
      integer: bigint;
      numerator: bigint;
      denominator: bigint;
    };
  };
  balances: {
    availableCkb: bigint;
    unavailableCkb: bigint;
    totalCkb: bigint;
    availableIckb: bigint;
    totalEquivalentCkb: bigint;
    totalEquivalentIckb: bigint;
    minimumCkbCapital: bigint;
    spendableCkb: bigint;
    matchableCkb: bigint;
  };
  orders: {
    marketCount: number;
    userCount: number;
    receiptCount: number;
  };
  withdrawals: {
    readyCount: number;
    pendingCount: number;
  };
  poolDeposits: {
    totalCount: number;
    readyCount: number;
  };
  match: {
    reason: BotMatchReason;
    partialCount: number;
    ckbDelta: bigint;
    udtDelta: bigint;
    matchedOrderOutPoints?: Array<{ txHash: ccc.Hex; index: string }>;
    matchedOrderMasterOutPoints?: Array<{ txHash: ccc.Hex; index: string }>;
    value?: bigint;
    diagnostics?: MatchDiagnostics;
  };
  rebalance: {
    kind: RebalancePlan["kind"];
    reason: BotRebalanceReason;
    depositQuantity?: number;
    withdrawalRequestCount?: number;
    requiredLiveDepositCount?: number;
    diagnostics?: RebalanceDiagnostics;
    outputSlots: number;
    projectedAvailableCkb: bigint;
    projectedAvailableIckb: bigint;
  };
  audit: {
    /** Reserve projection based on selected actions, not plain-cell accounting. */
    reserveCheck: {
      /** CKB available before applying selected match and rebalance actions. */
      availableCkb: bigint;
      /** CKB delta contributed by order matching. */
      matchCkbDelta: bigint;
      /** CKB cost of the selected rebalance action. */
      rebalanceCkbCost: bigint;
      /** Direct deposit capacity component of the rebalance cost. */
      directDepositCost: bigint;
      /** Withdrawal request capacity component of the rebalance cost. */
      withdrawalRequestCost: bigint;
      /** Optional estimated fee applied to the projection. */
      estimatedFee?: bigint;
      /** Projected available CKB after the candidate transaction. */
      projectedPostTransactionCkb: bigint;
      /** Required CKB reserve floor. */
      reserve: bigint;
      /** Positive shortfall below reserve after projection. */
      deficit: bigint;
      /** True when a withdrawal rebalance with non-negative match CKB delta may cross the immediate reserve. */
      recoveryException: boolean;
    };
    rebalanceCosts: {
      directDepositCapacity: bigint;
      directDepositFeeHeadroom: bigint;
      directDepositCost: bigint;
      withdrawalRequestCost: bigint;
    };
    selectedRing?: {
      targetSegmentIndex: number;
      targetDepositCount: number;
      targetUdtValue: bigint;
      totalPoolUdt: bigint;
      emptySegmentCount: number;
      nonemptySegmentCount: number;
      heaviestSegmentIndex: number;
      heaviestSegmentDepositCount: number;
      heaviestSegmentUdtValue: bigint;
      canCreateRingInventory: boolean;
      shouldBootstrapRing: boolean;
    };
  };
  actions: BotActions;
  fee: {
    feeRate: ccc.Num;
    estimated?: bigint;
  };
  transactionShape: {
    inputs: number;
    outputs: number;
    cellDeps: number;
    headerDeps: number;
    witnesses: number;
  };
  exchangeRatio: {
    ckbScale: bigint;
    udtScale: bigint;
  };
  depositCapacity: bigint;
  skip?: {
    reason: BotDecisionSkipReason;
    fee?: bigint;
    matchValue?: bigint;
    attemptedActions?: BotActions;
  };
}

export type BotStateSummary = Pick<
  BotDecisionTranscript,
  | "chainTip"
  | "balances"
  | "orders"
  | "withdrawals"
  | "poolDeposits"
  | "exchangeRatio"
  | "depositCapacity"
  | "fee"
>;
