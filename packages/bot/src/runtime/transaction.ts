import { ccc } from "@ckb-ccc/core";
import {
  type Match,
  type MatchSearchResult,
  OrderManager,
  receiptPhase2Capacity,
} from "@ickb/sdk";

import { planRebalance } from "../policy.ts";
import { auditSummary } from "./audit.ts";
import { buildDecisionTranscript } from "./decision.ts";
import {
  actionsForState,
  actionTotal,
  DIRECT_DEPOSIT_FEE_HEADROOM,
  emptyActions,
  isMatchOnly,
  MATCH_STEP_DIVISOR,
  matchableCkb,
  MAX_OUTPUTS_BEFORE_CHANGE,
  maxBigInt,
  usefulMatchFloors,
} from "./support.ts";
import type {
  BotActions,
  BotDecisionTranscript,
  BotMatchSearchEvidence,
  BotState,
  BuildTransactionResult,
  BuildTransactionSkipReason,
  CandidateTransaction,
  Runtime,
} from "./types.ts";

type CompletedDecisionTranscript = BotDecisionTranscript & {
  fee: BotDecisionTranscript["fee"] & { estimated: bigint };
};

/**
 * Plans the bot transaction for the current state, then applies fee and reserve gates.
 *
 * @remarks Matching is evaluated before rebalancing. Rebalance planning receives
 * only the output slots left by the match candidate so the final transaction has
 * room for fee/change completion.
 */
export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const prepared = prepareCandidateTransaction(runtime, state);
  const { match, candidate, outputSlots } = prepared;
  const actionCount = actionTotal(candidate.actions);
  if (actionCount === 0) {
    const matchSearch = candidate.decision.match.search;
    if (matchSearch !== undefined && match.partials.length === 0) {
      return skippedResult(
        "match_search_incomplete",
        candidate.actions,
        candidate.decision,
        { matchSearch },
      );
    }
    return skippedResult("no_actions", candidate.actions, candidate.decision);
  }
  if (candidate.tx.outputs.length > MAX_OUTPUTS_BEFORE_CHANGE) {
    return skippedResult(
      "output_limit",
      emptyActions(),
      {
        ...candidate.decision,
        actions: emptyActions(),
      },
      {
        attemptedActions: candidate.actions,
      },
    );
  }

  const { tx, decision } = await completeCandidateTransaction({
    runtime,
    state,
    match,
    candidate,
    outputSlots,
  });
  const reserveCheck = decision.audit.reserveCheck;
  if (
    !reserveCheck.recoveryException &&
    reserveCheck.projectedPostTransactionCkb < reserveCheck.reserve
  ) {
    return skippedResult(
      "post_tx_ckb_reserve",
      emptyActions(),
      {
        ...decision,
        actions: emptyActions(),
      },
      {
        attemptedActions: candidate.actions,
      },
    );
  }

  if (isMatchOnly(candidate.actions)) {
    return matchOnlyResult({
      state,
      match,
      fee: decision.fee.estimated,
      candidate,
      decision,
      tx,
    });
  }

  return { kind: "built", tx, actions: candidate.actions, decision };
}

function prepareCandidateTransaction(
  runtime: Runtime,
  state: BotState,
): {
  match: Match;
  candidate: CandidateTransaction;
  outputSlots: number;
} {
  // Match allowance scales with current deposit capacity, which keeps small
  // partial matches from consuming output slots without meaningful inventory gain.
  const ckbAllowanceStep = maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR);
  const searchResult = OrderManager.bestMatch(
    state.marketOrders,
    {
      ckbValue: matchableCkb(state.availableCkbBalance),
      udtValue: state.availableIckbBalance,
    },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      ckbAllowanceStep,
      maxPartials: MAX_OUTPUTS_BEFORE_CHANGE,
    },
  );
  const match = searchResult.match;
  const usefulFloors =
    searchResult.kind === "complete"
      ? usefulMatchFloors(match.diagnostics)
      : { ckb: 0n, ickb: 0n };
  const tx = runtime.managers.order.addMatch(ccc.Transaction.default(), match);

  const outputSlots = Math.max(0, MAX_OUTPUTS_BEFORE_CHANGE - tx.outputs.length);
  const rebalance = planRebalance({
    outputSlots,
    tip: state.system.tip,
    ickbBalance: state.availableIckbBalance + match.udtDelta,
    ckbBalance: state.availableCkbBalance + match.ckbDelta,
    directDepositCapacity:
      state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
    directDepositFeeHeadroom: DIRECT_DEPOSIT_FEE_HEADROOM,
    ickbRefillThreshold: usefulFloors.ickb,
    ckbRecoveryThreshold: reserveRecoveryThreshold(usefulFloors.ckb),
    poolDeposits: state.poolDeposits,
    readyDeposits: state.poolDeposits.filter((deposit) => deposit.isReady),
  });
  const candidate = buildCandidateTransaction({
    runtime,
    state,
    match,
    rebalance,
    outputSlots,
    tx,
    searchResult,
  });
  return { match, candidate, outputSlots };
}

async function completeCandidateTransaction({
  runtime,
  state,
  match,
  candidate,
  outputSlots,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  candidate: CandidateTransaction;
  outputSlots: number;
}): Promise<{
  tx: ccc.Transaction;
  decision: CompletedDecisionTranscript;
}> {
  const tx = await runtime.completeTransaction(candidate.tx, state.system.feeRate);
  const fee = tx.estimateFee(state.system.feeRate);
  const audit = auditSummary({
    runtime,
    state,
    match,
    rebalance: candidate.rebalance,
    fee,
  });
  const decision = buildDecisionTranscript({
    runtime,
    state,
    match,
    rebalance: candidate.rebalance,
    outputSlots,
    actions: candidate.actions,
    tx,
    matchReason: candidate.decision.match.reason,
    matchSearch: candidate.decision.match.search,
  });
  return {
    tx,
    decision: { ...decision, audit, fee: { ...decision.fee, estimated: fee } },
  };
}

function matchOnlyResult({
  state,
  match,
  fee,
  candidate,
  decision,
  tx,
}: {
  state: BotState;
  match: Match;
  fee: bigint;
  candidate: CandidateTransaction;
  decision: BotDecisionTranscript;
  tx: ccc.Transaction;
}): BuildTransactionResult {
  const matchValue =
    match.ckbDelta * state.system.exchangeRatio.ckbScale +
    match.udtDelta * state.system.exchangeRatio.udtScale;
  const valuedDecision = {
    ...decision,
    match: { ...decision.match, value: matchValue },
  };
  // Pure matches must beat the fee because no collection or rebalance action
  // justifies sending an otherwise value-neutral transaction.
  if (matchValue <= fee * state.system.exchangeRatio.ckbScale) {
    return skippedResult(
      "match_value_not_above_fee",
      emptyActions(),
      {
        ...valuedDecision,
        actions: emptyActions(),
      },
      {
        fee,
        matchValue,
        attemptedActions: candidate.actions,
      },
    );
  }
  return {
    kind: "built",
    tx,
    actions: candidate.actions,
    decision: valuedDecision,
  };
}

function buildCandidateTransaction({
  runtime,
  state,
  match,
  rebalance,
  outputSlots,
  tx: matchTx,
  searchResult,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  rebalance: CandidateTransaction["rebalance"];
  outputSlots: number;
  tx: ccc.Transaction;
  searchResult: MatchSearchResult;
}): CandidateTransaction {
  let tx = runtime.sdk.buildBaseTransaction(matchTx, {
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
    tx = runtime.managers.logic.deposit(
      tx,
      rebalance.quantity,
      state.depositCapacity,
      runtime.primaryLock,
    );
  }

  const actions = actionsForState(state, match, rebalance);
  return {
    tx,
    actions,
    rebalance,
    decision: buildDecisionTranscript({
      runtime,
      state,
      match,
      rebalance,
      outputSlots,
      actions,
      tx,
      matchReason:
        searchResult.kind === "incomplete" && match.partials.length === 0
          ? "search_incomplete"
          : undefined,
      matchSearch: incompleteSearchEvidence(searchResult),
    }),
  };
}

function reserveRecoveryThreshold(usefulCkbFloor: bigint): bigint {
  return maxBigInt(0n, usefulCkbFloor) + 1000n * ccc.fixedPointFrom(1);
}

function skippedResult(
  reason: BuildTransactionSkipReason,
  actions: BotActions,
  decision: BotDecisionTranscript,
  details?: {
    fee?: bigint;
    matchValue?: bigint;
    attemptedActions?: BotActions;
    matchSearch?: Exclude<
      NonNullable<BotDecisionTranscript["skip"]>["matchSearch"],
      undefined
    >;
  },
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

function incompleteSearchEvidence(
  result: MatchSearchResult,
): BotMatchSearchEvidence | undefined {
  if (result.kind === "complete") {
    return undefined;
  }
  const { kind, reason, searchMode, budget, work, truncation } = result;
  return { kind, reason, searchMode, budget, work, truncation };
}
