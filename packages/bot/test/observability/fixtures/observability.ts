import type { ccc } from "@ckb-ccc/core";
import type { BotActions, BuildTransactionResult } from "../../../src/runtime/types.ts";

export const BOT_OBSERVABILITY_SUITE = "bot observability";
export const SCAN_RACED_CHAIN_TIP = "scan raced chain tip";
export const POOL_REJECTED_RBF_MESSAGE = "Client request error PoolRejectedRBF";
export const RBF_REJECTED_DATA =
  'RBFRejected("Tx\'s current fee is 11795, expect it to >= 12326 to replace old txs")';
export const BOT_DECISION_SKIPPED = "bot.decision.skipped";
export const CREDENTIAL_CONFIG_FILE = "/run/credentials/config.json";
export const RESOLVE_FAILED_DEAD = "Resolve failed Dead(OutPoint(...))";
export const BOT_TRANSACTION_FAILED = "bot.transaction.failed";
export const OUTER_PUBLIC_FAILURE = "outer public failure";

export const noActions: BotActions = {
  collectedOrders: 0,
  completedDeposits: 0,
  matchedOrders: 0,
  deposits: 0,
  withdrawalRequests: 0,
  withdrawals: 0,
};

export function nestedRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return record(source[key], key);
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  throw new Error(`Expected record: ${label}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function emptyScript(byte: string): ccc.ScriptLike {
  return { codeHash: `0x${byte.repeat(32)}`, hashType: "type", args: "0x" };
}

export function emptyInput(byte: string): ccc.CellInputLike {
  return { previousOutput: { txHash: `0x${byte.repeat(32)}`, index: 0n } };
}

export function emptyCellDep(byte: string): ccc.CellDepLike {
  return {
    outPoint: { txHash: `0x${byte.repeat(32)}`, index: 0n },
    depType: "code",
  };
}

export function noActionDecisionTranscript(): BuildTransactionResult["decision"] {
  return {
    chainTip: {
      blockNumber: 1n,
      blockHash: `0x${"11".repeat(32)}`,
      timestamp: 2n,
      epoch: { integer: 3n, numerator: 0n, denominator: 1n },
    },
    balances: {
      availableCkb: 0n,
      unavailableCkb: 0n,
      totalCkb: 0n,
      availableIckb: 0n,
      totalEquivalentCkb: 0n,
      totalEquivalentIckb: 0n,
      minimumCkbCapital: 0n,
      spendableCkb: 0n,
      matchableCkb: 0n,
    },
    orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
    withdrawals: { readyCount: 0, pendingCount: 0 },
    poolDeposits: { totalCount: 0, readyCount: 0 },
    match: {
      reason: "no_market_orders",
      partialCount: 0,
      ckbDelta: 0n,
      udtDelta: 0n,
    },
    rebalance: {
      kind: "none",
      reason: "no_withdrawable_ickb",
      outputSlots: 58,
      projectedAvailableCkb: 0n,
      projectedAvailableIckb: 0n,
    },
    audit: {
      reserveCheck: {
        availableCkb: 0n,
        matchCkbDelta: 0n,
        rebalanceCkbCost: 0n,
        directDepositCost: 0n,
        withdrawalRequestCost: 0n,
        projectedPostTransactionCkb: 0n,
        reserve: 0n,
        deficit: 0n,
        recoveryException: false,
      },
      rebalanceCosts: {
        directDepositCapacity: 0n,
        directDepositFeeHeadroom: 0n,
        directDepositCost: 0n,
        withdrawalRequestCost: 0n,
      },
    },
    actions: noActions,
    fee: { feeRate: 1n },
    transactionShape: {
      inputs: 0,
      outputs: 0,
      cellDeps: 0,
      headerDeps: 0,
      witnesses: 0,
    },
    exchangeRatio: { ckbScale: 1n, udtScale: 1n },
    depositCapacity: 0n,
    skip: { reason: "no_actions" },
  };
}

const noActionSkipDecision = noActionDecisionTranscript();

export const NO_ACTION_SKIP_RESULT: BuildTransactionResult = {
  kind: "skipped",
  reason: "no_actions",
  actions: noActions,
  decision: {
    ...noActionSkipDecision,
    rebalance: {
      ...noActionSkipDecision.rebalance,
      diagnostics: {
        ring: {
          poolDepositCount: 2,
          canCreateRingInventory: true,
          shouldBootstrapRing: false,
          ringLength: 16n,
          segmentCount: 2,
          targetSegmentIndex: 0,
          targetSegmentUdtValue: 2n,
          totalPoolUdt: 2n,
          depositsShareOneSegment: true,
          segments: [
            {
              index: 0,
              depositCount: 2,
              udtValue: 2n,
              isTarget: true,
              protectedDepositCount: 1,
              protectedUdtValue: 2n,
              protectedOutPoints: ["0xprotected"],
              surplusDepositCount: 1,
              surplusUdtValue: 0n,
              surplusOutPoints: ["0xsurplus"],
            },
            {
              index: 1,
              depositCount: 0,
              udtValue: 0n,
              isTarget: false,
              protectedDepositCount: 0,
              protectedUdtValue: 0n,
              protectedOutPoints: [],
              surplusDepositCount: 0,
              surplusUdtValue: 0n,
              surplusOutPoints: [],
            },
          ],
        },
      },
    },
    audit: {
      ...noActionSkipDecision.audit,
      selectedRing: {
        targetSegmentIndex: 0,
        targetDepositCount: 2,
        targetUdtValue: 2n,
        totalPoolUdt: 2n,
        emptySegmentCount: 1,
        nonemptySegmentCount: 1,
        heaviestSegmentIndex: 0,
        heaviestSegmentDepositCount: 2,
        heaviestSegmentUdtValue: 2n,
        canCreateRingInventory: true,
        shouldBootstrapRing: false,
      },
    },
  },
};
