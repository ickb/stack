import { ccc } from "@ckb-ccc/core";
import { convert } from "@ickb/core";
import type { Match, MatchDiagnostics } from "@ickb/order";
import type { RebalancePlan } from "../policy.ts";
import { CKB_RESERVE } from "../policy/constants.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotState,
  BotStateSummary,
} from "./types.ts";

export const MATCH_STEP_DIVISOR = 100n;
export const MAX_OUTPUTS_BEFORE_CHANGE = 58;
export const DIRECT_DEPOSIT_FEE_HEADROOM = ccc.fixedPointFrom(1);

/**
 * Builds the stable public state summary emitted with bot decisions.
 */
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
      totalEquivalentCkb:
        state.totalCkbBalance +
        convert(false, state.availableIckbBalance, state.system.exchangeRatio),
      totalEquivalentIckb:
        convert(true, state.totalCkbBalance, state.system.exchangeRatio) +
        state.availableIckbBalance,
      minimumCkbCapital: state.minCkbBalance,
      spendableCkb: spendableCkb(state.availableCkbBalance),
      matchableCkb: matchableCkb(state.availableCkbBalance),
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
      totalCount: state.poolDeposits.length,
      readyCount: state.readyPoolDeposits.length,
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

export function emptyActions(): BotActions {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

export function actionTotal(actions: BotActions): number {
  return (
    actions.collectedOrders +
    actions.completedDeposits +
    actions.matchedOrders +
    actions.deposits +
    actions.withdrawalRequests +
    actions.withdrawals
  );
}

export function actionsForState(
  state: BotState,
  match: Match,
  rebalance: RebalancePlan,
): BotActions {
  return {
    collectedOrders: state.userOrders.length,
    completedDeposits: state.receipts.length,
    matchedOrders: match.partials.length,
    deposits: rebalance.kind === "deposit" ? rebalance.quantity : 0,
    withdrawalRequests: rebalance.kind === "withdraw" ? rebalance.deposits.length : 0,
    withdrawals: state.readyWithdrawals.length,
  };
}

export function isMatchOnly(actions: BotActions): boolean {
  return (
    actions.matchedOrders > 0 &&
    actions.collectedOrders === 0 &&
    actions.completedDeposits === 0 &&
    actions.deposits === 0 &&
    actions.withdrawalRequests === 0 &&
    actions.withdrawals === 0
  );
}

/**
 * Counts transaction sections for decision logs without exposing transaction contents.
 */
export function transactionShape(
  tx: ccc.Transaction,
): BotDecisionTranscript["transactionShape"] {
  return {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
    cellDeps: tx.cellDeps.length,
    headerDeps: tx.headerDeps.length,
    witnesses: tx.witnesses.length,
  };
}

export function usefulMatchFloors(diagnostics: MatchDiagnostics | undefined): {
  ckb: bigint;
  ickb: bigint;
} {
  if (diagnostics === undefined) {
    return { ckb: 0n, ickb: 0n };
  }
  return {
    ckb: usefulDirectionFloor(
      diagnostics.ckbAllowanceStep,
      diagnostics.directions.udtToCkb,
    ),
    ickb: usefulDirectionFloor(
      diagnostics.udtAllowanceStep,
      diagnostics.directions.ckbToUdt,
    ),
  };
}

function usefulDirectionFloor(
  allowanceStep: bigint,
  direction: MatchDiagnostics["directions"]["ckbToUdt"],
): bigint {
  if (direction.matchableCount === 0) {
    return 0n;
  }
  return maxBigInt(allowanceStep, direction.minAllowance ?? 0n);
}

export function matchableCkb(availableCkbBalance: bigint): bigint {
  return maxBigInt(0n, spendableCkb(availableCkbBalance) - DIRECT_DEPOSIT_FEE_HEADROOM);
}

function spendableCkb(availableCkbBalance: bigint): bigint {
  return maxBigInt(0n, availableCkbBalance - CKB_RESERVE);
}

export function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
