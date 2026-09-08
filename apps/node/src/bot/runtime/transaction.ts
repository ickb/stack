import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  type IckbDepositCell,
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
  MAX_MATCH_PARTIALS,
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
  RebalanceOutcome,
  Runtime,
} from "./types.ts";

type CompletedDecisionTranscript = BotDecisionTranscript & {
  fee: BotDecisionTranscript["fee"] & { estimated: bigint };
};

interface MatchOutcome {
  match: Match;
  searchResult: MatchSearchResult;
  tx: ccc.Transaction;
}

/**
 * Plans the bot transaction for the current state, then applies fee and reserve gates.
 *
 * @remarks Matching is evaluated before rebalancing. A withdrawal rebalance names greedy
 * candidates; the completion walk decides how many requests the transaction carries, with
 * the reserve check as its acceptance predicate (decisions amendment 41).
 */
export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const matched = matchOutcome(runtime, state);
  const rebalance = planRebalanceForMatch(runtime, state, matched);
  if (rebalance.kind === "withdraw") {
    const built = await buildWithdrawalTransaction(runtime, state, matched, rebalance);
    if (built !== undefined) {
      return built;
    }
  }
  const candidate = buildCandidateTransaction({
    runtime,
    state,
    matched,
    rebalance:
      rebalance.kind === "withdraw"
        ? {
            kind: "none",
            reason: "no_fundable_withdrawal_prefix",
            withdrawalCandidateCount: rebalance.deposits.length,
            diagnostics: rebalance.diagnostics,
          }
        : rebalance,
  });
  const { match } = matched;
  if (actionTotal(candidate.actions) === 0) {
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

  const { tx, decision } = await completeCandidateTransaction({
    runtime,
    state,
    match,
    candidate,
  });
  const reserveCheck = decision.audit.reserveCheck;
  if (
    !reserveCheck.recoveryException &&
    reserveCheck.projectedPostTransactionCkb < reserveCheck.reserve
  ) {
    return skippedResult(
      "post_tx_ckb_reserve",
      emptyActions(),
      { ...decision, actions: emptyActions() },
      { attemptedActions: candidate.actions },
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

function matchOutcome(runtime: Runtime, state: BotState): MatchOutcome {
  // Match allowance scales with current deposit capacity, which keeps small
  // partial matches from consuming outputs without meaningful inventory gain.
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
      maxPartials: MAX_MATCH_PARTIALS,
    },
  );
  const match = searchResult.match;
  return {
    match,
    searchResult,
    tx: runtime.managers.order.addMatch(ccc.Transaction.default(), match),
  };
}

function planRebalanceForMatch(
  runtime: Runtime,
  state: BotState,
  { match, searchResult }: MatchOutcome,
): ReturnType<typeof planRebalance> {
  const usefulFloors =
    searchResult.kind === "complete"
      ? usefulMatchFloors(match.diagnostics)
      : { ckb: 0n, ickb: 0n };
  return planRebalance({
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
}

/**
 * Completes the longest fundable prefix of the withdrawal candidates that passes the reserve
 * check; reserve recovery retries with any ready deposit when no surplus prefix passes.
 *
 * @returns `undefined` when no prefix with at least one request was accepted.
 */
async function buildWithdrawalTransaction(
  runtime: Runtime,
  state: BotState,
  matched: MatchOutcome,
  rebalance: Extract<RebalanceOutcome, { kind: "withdraw" }>,
): Promise<BuildTransactionResult | undefined> {
  const { match } = matched;
  // A withdrawal with non-negative match CKB delta is staged CKB recovery: it may cross
  // the immediate reserve because it restores CKB when it matures.
  const recoveryException = match.ckbDelta >= 0n;
  const walk = async (
    candidates: readonly IckbDepositCell[],
    ringSafe: boolean,
  ): Promise<BuildTransactionResult | undefined> => {
    const prefixes = Array.from({ length: candidates.length }, (_, index) => ({
      deposits: candidates.slice(0, candidates.length - index),
    }));
    const completion = await completeFirstFundable(
      prefixes,
      // The builders mutate the transaction they are given, so each prefix starts from
      // its own copy of the match; the shared match stays clean for the next candidate.
      (prefix) =>
        runtime.sdk.buildBaseTransaction(matched.tx.clone(), {
          withdrawalRequest: { deposits: prefix.deposits, lock: runtime.primaryLock },
          orders: state.userOrders,
          receipts: state.receipts,
          readyWithdrawals: state.readyWithdrawals,
        }),
      async (tx) => runtime.completeTransaction(tx, state.system.feeRate, state.cells),
      (tx, prefix) =>
        recoveryException ||
        auditSummary({
          runtime,
          state,
          match,
          rebalance: { ...rebalance, ...prefix },
          fee: tx.estimateFee(state.system.feeRate),
        }).reserveCheck.deficit === 0n,
    );
    if (completion === undefined) {
      return undefined;
    }
    const accepted: RebalanceOutcome = {
      ...rebalance,
      ...completion.candidate,
      ringSafe,
      withdrawalCandidateCount: candidates.length,
    };
    return completedResult({
      runtime,
      state,
      matched,
      rebalance: accepted,
      tx: completion.tx,
    });
  };
  return (
    (await walk(rebalance.deposits, rebalance.ringSafe)) ??
    (rebalance.fallback === undefined ? undefined : walk(rebalance.fallback, false))
  );
}

function completedResult({
  runtime,
  state,
  matched,
  rebalance,
  tx,
}: {
  runtime: Runtime;
  state: BotState;
  matched: MatchOutcome;
  rebalance: RebalanceOutcome;
  tx: ccc.Transaction;
}): BuildTransactionResult {
  const { match } = matched;
  const fee = tx.estimateFee(state.system.feeRate);
  const actions = actionsForState(state, match, rebalance);
  const decision = buildDecisionTranscript({
    runtime,
    state,
    match,
    rebalance,
    actions,
    tx,
    matchSearch: incompleteSearchEvidence(matched.searchResult),
  });
  return {
    kind: "built",
    tx,
    actions,
    decision: {
      ...decision,
      audit: auditSummary({ runtime, state, match, rebalance, fee }),
      fee: { ...decision.fee, estimated: fee },
    },
  };
}

async function completeCandidateTransaction({
  runtime,
  state,
  match,
  candidate,
}: {
  runtime: Runtime;
  state: BotState;
  match: Match;
  candidate: CandidateTransaction;
}): Promise<{
  tx: ccc.Transaction;
  decision: CompletedDecisionTranscript;
}> {
  const tx = await runtime.completeTransaction(
    candidate.tx,
    state.system.feeRate,
    state.cells,
  );
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
      { ...valuedDecision, actions: emptyActions() },
      { fee, matchValue, attemptedActions: candidate.actions },
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
  matched,
  rebalance,
}: {
  runtime: Runtime;
  state: BotState;
  matched: MatchOutcome;
  rebalance: RebalanceOutcome;
}): CandidateTransaction {
  const { match, searchResult } = matched;
  let tx = runtime.sdk.buildBaseTransaction(matched.tx.clone(), {
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
