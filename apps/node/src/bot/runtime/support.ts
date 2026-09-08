import type { ccc } from "@ckb-ccc/core";
import { convert, type Match } from "@ickb/sdk";

import { CKB_RESERVE } from "../policy/constants.ts";
import type { BotDecision, BotState, BotStateSummary } from "./types.ts";

export const MATCH_STEP_DIVISOR = 100n;
/**
 * Named bound on matched partials: the completion walk can shrink withdrawals to fit the
 * DAO output limit but never a fixed match, so the match keeps room for the rest.
 */
export const MAX_MATCH_PARTIALS = 58;

/** Builds the stable public state summary emitted with bot decisions. */
export function summarizeBotState(state: BotState): BotStateSummary {
  const { tip, exchangeRatio, feeRate } = state.system;
  return {
    chainTip: {
      blockNumber: tip.number,
      blockHash: tip.hash,
      timestamp: tip.timestamp,
      epoch: {
        integer: tip.epoch.integer,
        numerator: tip.epoch.numerator,
        denominator: tip.epoch.denominator,
      },
    },
    balances: {
      ckb: state.ckb,
      ickb: state.ickb,
      pendingCkb: state.pendingCkb,
      totalEquivalentCkb:
        state.ckb + state.pendingCkb + convert(false, state.ickb, exchangeRatio),
      matchableCkb: matchableCkb(state.ckb),
      cellCount: state.cells.length,
    },
    counts: {
      marketOrders: state.marketOrders.length,
      receipts: state.receipts.length,
      readyWithdrawals: state.readyWithdrawals.length,
      pendingWithdrawals: state.notReadyWithdrawals.length,
      poolDeposits: state.poolDeposits.length,
      readyPoolDeposits: state.poolDeposits.filter((deposit) => deposit.isReady).length,
    },
    exchangeRatio: { ckbScale: exchangeRatio.ckbScale, udtScale: exchangeRatio.udtScale },
    depositCapacity: state.depositCapacity,
    fee: { feeRate },
  };
}

export function transactionShape(tx: ccc.Transaction): BotDecision["transactionShape"] {
  return {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
    cellDeps: tx.cellDeps.length,
    headerDeps: tx.headerDeps.length,
    witnesses: tx.witnesses.length,
  };
}

/** CKB a match may spend: what is available above the reserve. */
export function matchableCkb(ckb: bigint): bigint {
  return maxBigInt(0n, ckb - CKB_RESERVE);
}

export function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

export function matchedOrderOutPoints(
  partials: Match["partials"],
): Array<{ txHash: ccc.Hex; index: string }> {
  return partials.map((partial) => ({
    txHash: partial.group.order.cell.outPoint.txHash,
    index: String(partial.group.order.cell.outPoint.index),
  }));
}
