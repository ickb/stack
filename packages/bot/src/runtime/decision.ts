import type { ccc } from "@ckb-ccc/core";
import type { Match, MatchDiagnostics } from "@ickb/order";
import type { RebalancePlan } from "../policy.ts";
import { auditSummary } from "./audit.ts";
import { summarizeBotState, transactionShape } from "./support.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotMatchReason,
  BotState,
  Runtime,
} from "./types.ts";

export function buildDecisionTranscript({
  runtime,
  state,
  match,
  rebalance,
  outputSlots,
  actions,
  tx,
}: {
  runtime: Runtime;
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
      ...(match.partials.length === 0
        ? {}
        : {
            matchedOrderOutPoints: matchedOrderOutPoints(match.partials),
            matchedOrderMasterOutPoints: matchedOrderMasterOutPoints(match.partials),
          }),
      ...(match.diagnostics === undefined ? {} : { diagnostics: match.diagnostics }),
    },
    rebalance: rebalanceSummary(rebalance, outputSlots, state, match),
    audit: auditSummary({ runtime, state, match, rebalance }),
    actions,
    fee: {
      feeRate: state.system.feeRate,
    },
    transactionShape: transactionShape(tx),
  };
}

function matchedOrderOutPoints(
  partials: Match["partials"],
): Array<{ txHash: ccc.Hex; index: string }> {
  return partials.map((partial) => ({
    txHash: partial.order.cell.outPoint.txHash,
    index: String(partial.order.cell.outPoint.index),
  }));
}

function matchedOrderMasterOutPoints(
  partials: Match["partials"],
): Array<{ txHash: ccc.Hex; index: string }> {
  return partials.map((partial) => {
    const master = partial.order.getMaster();
    return {
      txHash: master.txHash,
      index: String(master.index),
    };
  });
}

function rebalanceSummary(
  rebalance: RebalancePlan,
  outputSlots: number,
  state: BotState,
  match: { ckbDelta: bigint; udtDelta: bigint },
): BotDecisionTranscript["rebalance"] {
  return {
    kind: rebalance.kind,
    reason: rebalance.reason,
    ...(rebalance.kind === "deposit" ? { depositQuantity: rebalance.quantity } : {}),
    ...(rebalance.kind === "withdraw"
      ? {
          withdrawalRequestCount: rebalance.deposits.length,
          requiredLiveDepositCount: rebalance.requiredLiveDeposits?.length ?? 0,
        }
      : {}),
    ...(rebalance.diagnostics === undefined
      ? {}
      : { diagnostics: rebalance.diagnostics }),
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
    return noViableCandidateReason(diagnostics);
  }
  return viableCandidateMissReason(diagnostics);
}

function noViableCandidateReason(diagnostics: MatchDiagnostics): BotMatchReason {
  return hasInsufficientAllowanceRejection(diagnostics)
    ? "insufficient_allowance"
    : "no_viable_candidates";
}

function viableCandidateMissReason(diagnostics: MatchDiagnostics): BotMatchReason {
  if (diagnostics.candidates.positiveGain > 0) {
    return "no_viable_candidates";
  }
  if (diagnostics.candidates.rejected.maxPartials > 0) {
    return "max_partials";
  }
  return hasInsufficientAllowanceRejection(diagnostics)
    ? "insufficient_allowance"
    : "no_positive_gain";
}

function hasInsufficientAllowanceRejection(diagnostics: MatchDiagnostics): boolean {
  return (
    diagnostics.candidates.rejected.insufficientCkbAllowance > 0 ||
    diagnostics.candidates.rejected.insufficientUdtAllowance > 0
  );
}
