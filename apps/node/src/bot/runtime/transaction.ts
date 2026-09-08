import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  DAO_HEADER_INDEX_LIMIT,
  type IckbDepositCell,
  type Match,
  type MatchSearchResult,
  OrderManager,
  receiptPhase2Capacity,
} from "@ickb/sdk";

import { planRebalance, type RebalancePlan } from "../policy.ts";
import { CKB_RESERVE } from "../policy/constants.ts";
import {
  MATCH_STEP_DIVISOR,
  matchableCkb,
  matchedOrderOutPoints,
  MAX_MATCH_PARTIALS,
  maxBigInt,
  summarizeBotState,
  transactionShape,
} from "./support.ts";
import type {
  BotActions,
  BotDecision,
  BotMatchReason,
  BotMatchSearchEvidence,
  BotState,
  BuildTransactionResult,
  BuildTransactionSkipReason,
  Core,
  Runtime,
} from "./types.ts";

interface MatchOutcome {
  match: Match;
  searchResult: MatchSearchResult;
  tx: ccc.Transaction;
}

/**
 * One turn's transaction: the best match, then one rebalance core the completion walk can
 * fund (deposit first, then withdrawal chains, then none), with collections and the sweep
 * riding along. Matches and deposits must leave the reserve in plain CKB after fees;
 * withdrawal requests bring CKB back, so they only need to complete (decisions amendment 52).
 */
function matchReason(
  match: Match,
  searchResult: MatchSearchResult,
  state: BotState,
): BotMatchReason {
  if (match.partials.length > 0) {
    return "matched";
  }
  if (searchResult.kind === "incomplete") {
    return "search_incomplete";
  }
  return state.marketOrders.length === 0 ? "no_market_orders" : "no_match";
}

export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const matched = matchOutcome(runtime, state);
  const { match, searchResult } = matched;
  const plan = planRebalance({
    tip: state.system.tip,
    ickb: state.ickb + match.udtDelta,
    ckb: state.ckb + match.ckbDelta,
    depositCost: state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
    poolDeposits: state.poolDeposits,
  });
  const hasCollections = state.receipts.length > 0 || state.readyWithdrawals.length > 0;
  const cores = candidateCores(plan, match.partials.length > 0 || hasCollections);
  const decision = (core: Core, attempts: number, tx?: ccc.Transaction): BotDecision =>
    buildDecision({ state, matched, plan, core, attempts, tx });

  if (cores.length === 0) {
    const skip = decision({ kind: "none" }, 0);
    return searchResult.kind === "incomplete"
      ? skipped("match_search_incomplete", skip, { matchSearch: skip.match.search })
      : skipped("no_actions", skip);
  }

  let attempts = 0;
  const completion = await completeFirstFundable(
    cores,
    (core) => {
      attempts += 1;
      return buildCore(runtime, state, matched, core);
    },
    async (tx) => runtime.completeTransaction(tx, state.system.feeRate, state.cells),
    (tx, core) =>
      core.kind === "withdraw" || plainCkbAfter(tx, runtime.primaryLock) >= CKB_RESERVE,
  );
  if (completion === undefined) {
    return skipped("no_fundable_candidate", decision({ kind: "none" }, attempts));
  }
  const { candidate: core, tx } = completion;
  const built = decision(core, attempts, tx);
  if (core.kind === "none" && !hasCollections) {
    // A pure match must beat the fee of its own bytes; the sweep never vetoes it.
    const matchValue = matchValueCkb(match, state);
    const fee = matched.tx.estimateFee(state.system.feeRate);
    built.match.value = matchValue;
    if (matchValue <= fee) {
      return skipped("match_value_not_above_fee", built, { fee, matchValue });
    }
  }
  return { kind: "built", tx, actions: built.actions, decision: built };
}

function matchOutcome(runtime: Runtime, state: BotState): MatchOutcome {
  const searchResult = OrderManager.bestMatch(
    state.marketOrders,
    { ckbValue: matchableCkb(state.ckb), udtValue: state.ickb },
    state.system.exchangeRatio,
    {
      feeRate: state.system.feeRate,
      // The step scales with deposit capacity so tiny partials never crowd the outputs.
      ckbAllowanceStep: maxBigInt(1n, state.depositCapacity / MATCH_STEP_DIVISOR),
      maxPartials: MAX_MATCH_PARTIALS,
    },
  );
  const { match } = searchResult;
  return {
    match,
    searchResult,
    tx: runtime.managers.order.addMatch(ccc.Transaction.default(), match),
  };
}

/**
 * Deposit first, then every withdrawal chain: the greedy fit from the oldest candidate,
 * longest prefix first, then the same rebuilt without the oldest, and so on; `none` last so
 * collections and the match still send when no rebalance can be funded.
 */
/** The cores to try in order; an empty core is a candidate only when a match or a collection rides on it. */
function candidateCores(plan: RebalancePlan, rideAlong: boolean): Core[] {
  const cores: Core[] = [];
  if (plan.deposit !== undefined) {
    cores.push({ kind: "deposit", reason: plan.deposit.reason });
  }
  if (plan.withdrawal !== undefined) {
    cores.push(...withdrawalCores(plan.withdrawal));
  }
  if (rideAlong) {
    cores.push({ kind: "none" });
  }
  return cores;
}

/**
 * Every prefix of the greedy chain from every start, longest first, so completion can fall
 * back to a shorter or later chain. A start whose own deposit exceeds the budget repeats
 * the next start's chain, so it is skipped.
 */
function withdrawalCores({
  candidates,
  budget,
  stress,
}: NonNullable<RebalancePlan["withdrawal"]>): Core[] {
  const cores: Core[] = [];
  for (const [start, first] of candidates.entries()) {
    if (first.udtValue > budget) {
      continue;
    }
    const chain = greedyFit(candidates.slice(start), budget);
    for (let length = chain.length; length > 0; length -= 1) {
      cores.push({ kind: "withdraw", deposits: chain.slice(0, length), stress });
    }
  }
  return cores;
}

function greedyFit(
  candidates: readonly IckbDepositCell[],
  budget: bigint,
): IckbDepositCell[] {
  const chain: IckbDepositCell[] = [];
  let total = 0n;
  for (const deposit of candidates) {
    if (total + deposit.udtValue > budget) {
      continue;
    }
    total += deposit.udtValue;
    chain.push(deposit);
  }
  return chain;
}

/** The match and every collection ride on each core; the builders mutate their input. */
function buildCore(
  runtime: Runtime,
  state: BotState,
  matched: MatchOutcome,
  core: Core,
): ccc.Transaction {
  let tx = runtime.sdk.buildBaseTransaction(matched.tx.clone(), {
    ...(core.kind === "withdraw"
      ? { withdrawalRequest: { deposits: core.deposits, lock: runtime.primaryLock } }
      : {}),
    receipts: state.receipts,
    // The deployed DAO script addresses 255 deposit headers; the rest wait a turn.
    readyWithdrawals: state.readyWithdrawals.slice(0, DAO_HEADER_INDEX_LIMIT - 1),
  });
  if (core.kind === "deposit") {
    tx = runtime.managers.logic.deposit(
      tx,
      1,
      state.depositCapacity,
      runtime.primaryLock,
    );
  }
  return tx;
}

/** Plain CKB the bot keeps after the transaction: its own plain outputs. */
function plainCkbAfter(tx: ccc.Transaction, lock: ccc.Script): bigint {
  let total = 0n;
  for (const cell of tx.outputCells) {
    if (
      cell.cellOutput.lock.eq(lock) &&
      cell.cellOutput.type === undefined &&
      cell.outputData === "0x"
    ) {
      total += cell.cellOutput.capacity;
    }
  }
  return total;
}

function matchValueCkb(match: Match, state: BotState): bigint {
  const { ckbScale, udtScale } = state.system.exchangeRatio;
  return match.ckbDelta + (match.udtDelta * udtScale) / ckbScale;
}

function buildDecision({
  state,
  matched,
  plan,
  core,
  attempts,
  tx,
}: {
  state: BotState;
  matched: MatchOutcome;
  plan: RebalancePlan;
  core: Core;
  attempts: number;
  tx?: ccc.Transaction;
}): BotDecision {
  const { match, searchResult } = matched;
  const actions: BotActions = {
    matchedOrders: match.partials.length,
    deposits: core.kind === "deposit" ? 1 : 0,
    withdrawalRequests: core.kind === "withdraw" ? core.deposits.length : 0,
    completedDeposits: tx === undefined ? 0 : state.receipts.length,
    withdrawals: tx === undefined ? 0 : state.readyWithdrawals.length,
  };
  return {
    ...summarizeBotState(state),
    match: {
      reason: matchReason(match, searchResult, state),
      partialCount: match.partials.length,
      ckbDelta: match.ckbDelta,
      udtDelta: match.udtDelta,
      ...(match.partials.length === 0
        ? {}
        : { matchedOrderOutPoints: matchedOrderOutPoints(match.partials) }),
      ...(match.diagnostics === undefined ? {} : { diagnostics: match.diagnostics }),
      ...(searchResult.kind === "complete"
        ? {}
        : { search: incompleteSearchEvidence(searchResult) }),
    },
    rebalance: {
      ...(plan.deposit === undefined ? {} : { deposit: plan.deposit.reason }),
      ...(plan.withdrawal === undefined
        ? {}
        : {
            withdrawal: {
              candidateCount: plan.withdrawal.candidates.length,
              stress: plan.withdrawal.stress,
            },
          }),
      ring: plan.ring,
    },
    core: { kind: core.kind, withdrawalRequests: actions.withdrawalRequests, attempts },
    actions,
    fee: {
      feeRate: state.system.feeRate,
      ...(tx === undefined ? {} : { estimated: tx.estimateFee(state.system.feeRate) }),
    },
    ...(tx === undefined ? {} : { transactionShape: transactionShape(tx) }),
  };
}

function skipped(
  reason: BuildTransactionSkipReason,
  decision: BotDecision,
  details: {
    fee?: bigint;
    matchValue?: bigint;
    matchSearch?: BotMatchSearchEvidence;
  } = {},
): BuildTransactionResult {
  return {
    kind: "skipped",
    reason,
    actions: decision.actions,
    decision: { ...decision, skip: { reason, ...details } },
  };
}

function incompleteSearchEvidence(
  result: Extract<MatchSearchResult, { kind: "incomplete" }>,
): BotMatchSearchEvidence {
  const { kind, reason, searchMode, budget, work, truncation } = result;
  return { kind, reason, searchMode, budget, work, truncation };
}
