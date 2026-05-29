import { ccc } from "@ckb-ccc/core";
import {
  convert,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import {
  OrderManager,
  type Match,
  type MatchDiagnostics,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";
import { type getConfig, type IckbSdk, type SystemState } from "@ickb/sdk";
import { accountPlainCkbBalance, postTransactionAccountPlainCkbBalance, type SupportedChain } from "@ickb/node-utils";
import {
  CKB_RESERVE,
  planRebalance,
  type RebalanceNoopReason,
  type RebalancePlan,
} from "./policy.js";

const MATCH_STEP_DIVISOR = 100n;
const MAX_OUTPUTS_BEFORE_CHANGE = 58;

export interface Runtime {
  chain: SupportedChain;
  client: ccc.Client;
  signer: ccc.SignerCkbPrivateKey;
  sdk: IckbSdk;
  managers: ReturnType<typeof getConfig>["managers"];
  primaryLock: ccc.Script;
}

export interface BotState {
  accountLocks: ccc.Script[];
  capacityCells: ccc.Cell[];
  system: SystemState;
  userOrders: OrderGroup[];
  marketOrders: OrderCell[];
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  notReadyWithdrawals: WithdrawalGroup[];
  readyPoolDeposits: IckbDepositCell[];
  nearReadyPoolDeposits: IckbDepositCell[];
  futurePoolDeposits: IckbDepositCell[];
  availableCkbBalance: bigint;
  availableIckbBalance: bigint;
  unavailableCkbBalance: bigint;
  totalCkbBalance: bigint;
  depositCapacity: bigint;
  minCkbBalance: bigint;
}

export interface BotActions {
  collectedOrders: number;
  completedDeposits: number;
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  withdrawals: number;
}

export type BuildTransactionSkipReason =
  | "no_actions"
  | "match_value_not_above_fee"
  | "post_tx_ckb_reserve";

export type BotDecisionSkipReason =
  | BuildTransactionSkipReason
  | "capital_below_minimum";

export type BotMatchReason =
  | "matched"
  | "no_market_orders"
  | "no_matchable_orders"
  | "insufficient_allowance"
  | "no_viable_candidates"
  | "max_partials"
  | "no_positive_gain";

export type BotRebalanceReason =
  | RebalanceNoopReason
  | "low_ickb_balance"
  | "future_pool_inventory"
  | "excess_ickb_balance";

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
    readyCount: number;
    nearReadyCount: number;
    futureCount: number;
  };
  match: {
    reason: BotMatchReason;
    partialCount: number;
    ckbDelta: bigint;
    udtDelta: bigint;
    value?: bigint;
    diagnostics?: MatchDiagnostics;
  };
  rebalance: {
    kind: RebalancePlan["kind"];
    reason: BotRebalanceReason;
    depositQuantity?: number;
    withdrawalRequestCount?: number;
    requiredLiveDepositCount?: number;
    diagnostics?: RebalancePlan["diagnostics"];
    outputSlots: number;
    projectedAvailableCkb: bigint;
    projectedAvailableIckb: bigint;
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
    postTxCkbBalance?: bigint;
    reserve?: bigint;
    deficit?: bigint;
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

export type { SupportedChain };

export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const match = OrderManager.bestMatch(
    state.marketOrders,
    {
      ckbValue: spendableCkb(state.availableCkbBalance),
      udtValue: state.availableIckbBalance,
    },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      ckbAllowanceStep: maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR),
      maxPartials: MAX_OUTPUTS_BEFORE_CHANGE,
    },
  );
  let tx = ccc.Transaction.default();
  if (match.partials.length > 0) {
    tx = runtime.managers.order.addMatch(tx, match);
  }

  const outputSlots = Math.max(0, MAX_OUTPUTS_BEFORE_CHANGE - tx.outputs.length);
  const rebalance = planRebalance({
    outputSlots,
    tip: state.system.tip,
    ickbBalance: state.availableIckbBalance + match.udtDelta,
    ckbBalance: state.availableCkbBalance + match.ckbDelta,
    depositCapacity: state.depositCapacity,
    readyDeposits: state.readyPoolDeposits,
    nearReadyDeposits: state.nearReadyPoolDeposits,
    futurePoolDeposits: state.futurePoolDeposits,
  });
  tx = await runtime.sdk.buildBaseTransaction(tx, runtime.client, {
    withdrawalRequest:
      rebalance.kind === "withdraw"
        ? {
            deposits: rebalance.deposits,
            requiredLiveDeposits: rebalance.requiredLiveDeposits,
            lock: runtime.primaryLock,
          }
        : undefined,
    orders: state.userOrders,
    receipts: state.receipts,
    readyWithdrawals: state.readyWithdrawals,
  });
  if (rebalance.kind === "deposit") {
    tx = await runtime.managers.logic.deposit(
      tx,
      rebalance.quantity,
      state.depositCapacity,
      runtime.primaryLock,
      runtime.client,
    );
  }

  const actions: BotActions = {
    collectedOrders: state.userOrders.length,
    completedDeposits: state.receipts.length,
    matchedOrders: match.partials.length,
    deposits:
      rebalance.kind === "deposit" ? rebalance.quantity : 0,
    withdrawalRequests:
      rebalance.kind === "withdraw" ? rebalance.deposits.length : 0,
    withdrawals: state.readyWithdrawals.length,
  };
  const actionCount = actionTotal(actions);
  let decision = buildDecisionTranscript({
    state,
    match,
    rebalance,
    outputSlots,
    actions,
    tx,
  });
  if (actionCount === 0) {
    return skippedResult("no_actions", actions, decision);
  }

  tx = await runtime.sdk.completeTransaction(tx, {
    signer: runtime.signer,
    client: runtime.client,
    feeRate: state.system.feeRate,
  });
  const fee = tx.estimateFee(state.system.feeRate);
  const preTxCkbBalance = accountPlainCkbBalance(state.capacityCells, state.accountLocks);
  const postTxCkbBalance = postTransactionPlainCkbBalance(tx, state);
  decision = buildDecisionTranscript({
    state,
    match,
    rebalance,
    outputSlots,
    actions,
    tx,
  });
  decision = { ...decision, fee: { ...decision.fee, estimated: fee } };
  const preTxDeficit = maxBigInt(0n, CKB_RESERVE - preTxCkbBalance);
  const postTxDeficit = maxBigInt(0n, CKB_RESERVE - postTxCkbBalance);
  // The reserve is actual owned plain CKB, not projected CKB availability. Ready
  // withdrawals and collectable orders can make projected CKB look healthy while
  // the account still lacks plain cells for state rent and future fees.
  //
  // Most actions must not create or worsen a plain-CKB reserve deficit. The one
  // intentional exception is an iCKB withdrawal request: it spends plain CKB for
  // DAO withdrawal-cell rent now so the bot can recover CKB in a later completion
  // transaction. Do not let CKB-spending matches or deposits hide behind that
  // recovery exception.
  const spendsReserveForWithdrawalRequest = actions.withdrawalRequests > 0 &&
    actions.deposits === 0 &&
    match.ckbDelta >= 0n;
  if (postTxDeficit > preTxDeficit && !spendsReserveForWithdrawalRequest) {
    return skippedResult("post_tx_ckb_reserve", emptyActions(), {
      ...decision,
      actions: emptyActions(),
    }, {
      attemptedActions: actions,
      postTxCkbBalance,
      reserve: CKB_RESERVE,
      deficit: postTxDeficit,
    });
  }

  if (isMatchOnly(actions)) {
    const matchValue =
      match.ckbDelta * state.system.exchangeRatio.ckbScale +
      match.udtDelta * state.system.exchangeRatio.udtScale;
    decision = {
      ...decision,
      match: { ...decision.match, value: matchValue },
    };
    if (matchValue <= fee * state.system.exchangeRatio.ckbScale) {
      return skippedResult("match_value_not_above_fee", actions, decision, {
        fee,
        matchValue,
      });
    }
  }

  return { kind: "built", tx, actions, decision };
}

export function summarizeBotState(state: BotState): BotStateSummary {
  return {
    chainTip: {
      blockNumber: state.system.tip.number,
      blockHash: state.system.tip.hash,
      timestamp: state.system.tip.timestamp,
      epoch: {
        integer: state.system.tip.epoch.integer,
        numerator: state.system.tip.epoch.numerator,
        denominator: state.system.tip.epoch.denominator,
      },
    },
    balances: {
      availableCkb: state.availableCkbBalance,
      unavailableCkb: state.unavailableCkbBalance,
      totalCkb: state.totalCkbBalance,
      availableIckb: state.availableIckbBalance,
      totalEquivalentCkb: state.totalCkbBalance +
        convert(false, state.availableIckbBalance, state.system.exchangeRatio),
      totalEquivalentIckb: convert(true, state.totalCkbBalance, state.system.exchangeRatio) +
        state.availableIckbBalance,
      minimumCkbCapital: state.minCkbBalance,
      spendableCkb: spendableCkb(state.availableCkbBalance),
    },
    orders: {
      marketCount: state.marketOrders.length,
      userCount: state.userOrders.length,
      receiptCount: state.receipts.length,
    },
    withdrawals: {
      readyCount: state.readyWithdrawals.length,
      pendingCount: state.notReadyWithdrawals.length,
    },
    poolDeposits: {
      readyCount: state.readyPoolDeposits.length,
      nearReadyCount: state.nearReadyPoolDeposits.length,
      futureCount: state.futurePoolDeposits.length,
    },
    exchangeRatio: {
      ckbScale: state.system.exchangeRatio.ckbScale,
      udtScale: state.system.exchangeRatio.udtScale,
    },
    depositCapacity: state.depositCapacity,
    fee: {
      feeRate: state.system.feeRate,
    },
  };
}

function isMatchOnly(actions: {
  collectedOrders: number;
  completedDeposits: number;
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  withdrawals: number;
}): boolean {
  return (
    actions.matchedOrders > 0 &&
    actions.collectedOrders === 0 &&
    actions.completedDeposits === 0 &&
    actions.deposits === 0 &&
    actions.withdrawalRequests === 0 &&
    actions.withdrawals === 0
  );
}

function buildDecisionTranscript({
  state,
  match,
  rebalance,
  outputSlots,
  actions,
  tx,
}: {
  state: BotState;
  match: Pick<Match, "partials" | "ckbDelta" | "udtDelta" | "diagnostics">;
  rebalance: RebalancePlan;
  outputSlots: number;
  actions: BotActions;
  tx: ccc.Transaction;
}): BotDecisionTranscript {
  const summary = summarizeBotState(state);
  return {
    ...summary,
    match: {
      reason: matchReason(match, state),
      partialCount: match.partials.length,
      ckbDelta: match.ckbDelta,
      udtDelta: match.udtDelta,
      ...(match.diagnostics === undefined ? {} : { diagnostics: match.diagnostics }),
    },
    rebalance: rebalanceSummary(rebalance, outputSlots, state, match),
    actions,
    fee: {
      feeRate: state.system.feeRate,
    },
    transactionShape: transactionShape(tx),
  };
}

function rebalanceSummary(
  rebalance: RebalancePlan,
  outputSlots: number,
  state: BotState,
  match: { ckbDelta: bigint; udtDelta: bigint },
): BotDecisionTranscript["rebalance"] {
  return {
    kind: rebalance.kind,
    reason: rebalanceReason(rebalance),
    ...(rebalance.kind === "deposit" ? { depositQuantity: rebalance.quantity } : {}),
    ...(rebalance.kind === "withdraw"
      ? {
          withdrawalRequestCount: rebalance.deposits.length,
          requiredLiveDepositCount: rebalance.requiredLiveDeposits?.length ?? 0,
        }
      : {}),
    ...(rebalance.diagnostics === undefined ? {} : { diagnostics: rebalance.diagnostics }),
    outputSlots,
    projectedAvailableCkb: state.availableCkbBalance + match.ckbDelta,
    projectedAvailableIckb: state.availableIckbBalance + match.udtDelta,
  };
}

function matchReason(
  match: Pick<Match, "partials" | "diagnostics">,
  state: BotState,
): BotMatchReason {
  if (match.partials.length > 0) {
    return "matched";
  }
  if (state.marketOrders.length === 0) {
    return "no_market_orders";
  }

  const diagnostics = match.diagnostics;
  if (diagnostics === undefined) {
    return "no_viable_candidates";
  }
  if (
    diagnostics.directions.ckbToUdt.matchableCount === 0 &&
    diagnostics.directions.udtToCkb.matchableCount === 0
  ) {
    return "no_matchable_orders";
  }
  if (diagnostics.candidates.viable === 0) {
    return diagnostics.candidates.rejected.insufficientCkbAllowance > 0 ||
      diagnostics.candidates.rejected.insufficientUdtAllowance > 0
      ? "insufficient_allowance"
      : "no_viable_candidates";
  }
  if (diagnostics.candidates.rejected.maxPartials > 0 && diagnostics.candidates.positiveGain === 0) {
    return "max_partials";
  }
  if (diagnostics.candidates.positiveGain === 0) {
    return "no_positive_gain";
  }
  return "no_viable_candidates";
}

function rebalanceReason(rebalance: RebalancePlan): BotRebalanceReason {
  switch (rebalance.kind) {
    case "none":
      return rebalance.reason;
    case "deposit":
      return rebalance.diagnostics === undefined
        ? "low_ickb_balance"
        : "future_pool_inventory";
    case "withdraw":
      return "excess_ickb_balance";
  }
}

export function transactionShape(tx: ccc.Transaction): BotDecisionTranscript["transactionShape"] {
  return {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
    cellDeps: tx.cellDeps.length,
    headerDeps: tx.headerDeps.length,
    witnesses: tx.witnesses.length,
  };
}

export function postTransactionPlainCkbBalance(tx: ccc.Transaction, state: BotState): bigint {
  return postTransactionAccountPlainCkbBalance(tx, state.capacityCells, state.accountLocks);
}

function skippedResult(
  reason: BuildTransactionSkipReason,
  actions: BotActions,
  decision: BotDecisionTranscript,
  details?: { fee?: bigint; matchValue?: bigint; postTxCkbBalance?: bigint; reserve?: bigint; deficit?: bigint; attemptedActions?: BotActions },
): BuildTransactionResult {
  return {
    kind: "skipped",
    reason,
    actions,
    decision: {
      ...decision,
      skip: {
        reason,
        ...details,
      },
    },
  };
}

function emptyActions(): BotActions {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

function actionTotal(actions: BotActions): number {
  return actions.collectedOrders +
    actions.completedDeposits +
    actions.matchedOrders +
    actions.deposits +
    actions.withdrawalRequests +
    actions.withdrawals;
}

function spendableCkb(availableCkbBalance: bigint): bigint {
  return maxBigInt(0n, availableCkbBalance - CKB_RESERVE);
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
