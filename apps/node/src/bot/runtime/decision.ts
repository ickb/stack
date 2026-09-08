import type { ccc } from "@ckb-ccc/core";
import type { Match, MatchDiagnostics } from "@ickb/sdk";

import { auditSummary } from "./audit.ts";
import { summarizeBotState, transactionShape } from "./support.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotMatchReason,
  BotMatchSearchEvidence,
  BotState,
  RebalanceOutcome,
  Runtime,
} from "./types.ts";

export function buildDecisionTranscript({
  runtime,
  state,
  match,
  rebalance,
  actions,
  tx,
  matchReason: explicitMatchReason,
  matchSearch,
}: {
  runtime: Runtime;
  state: BotState;
  match: Pick<Match, "partials" | "ckbDelta" | "udtDelta" | "diagnostics">;
  rebalance: RebalanceOutcome;
  actions: BotActions;
  tx: ccc.Transaction;
  matchReason?: BotMatchReason;
  matchSearch?: BotMatchSearchEvidence;
}): BotDecisionTranscript {
  const summary = summarizeBotState(state);
  return {
    ...summary,
    match: {
      reason: explicitMatchReason ?? matchReason(match, state),
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
      ...(matchSearch === undefined ? {} : { search: matchSearch }),
    },
    rebalance: rebalanceSummary(rebalance, state, match),
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
    txHash: partial.group.order.cell.outPoint.txHash,
    index: String(partial.group.order.cell.outPoint.index),
  }));
}

function matchedOrderMasterOutPoints(
  partials: Match["partials"],
): Array<{ txHash: ccc.Hex; index: string }> {
  return partials.map((partial) => {
    const master = partial.group.order.getMaster();
    return {
      txHash: master.txHash,
      index: String(master.index),
    };
  });
}

function rebalanceSummary(
  rebalance: RebalanceOutcome,
  state: BotState,
  match: { ckbDelta: bigint; udtDelta: bigint },
): BotDecisionTranscript["rebalance"] {
  return {
    kind: rebalance.kind,
    reason: rebalance.reason,
    ...(rebalance.kind === "deposit" ? { depositQuantity: rebalance.quantity } : {}),
    ...(rebalance.kind === "withdraw"
      ? { withdrawalRequestCount: rebalance.deposits.length }
      : {}),
    ...(rebalance.withdrawalCandidateCount === undefined
      ? {}
      : { withdrawalCandidateCount: rebalance.withdrawalCandidateCount }),
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
