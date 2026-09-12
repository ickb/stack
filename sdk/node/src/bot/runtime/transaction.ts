import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  type FundableCompletion,
  isFundabilityFailure,
} from "../../../../src/conversion/withdrawal_completion.ts";
import {
  DAO_HEADER_INDEX_LIMIT,
  type IckbDepositCell,
  receiptPhase2Capacity,
} from "../../../../src/core/index.ts";

import { matchTurn, seedOf, type TurnMatch } from "../match.ts";
import { planRebalance, type RebalancePlan } from "../policy.ts";
import {
  matchableCkb,
  matchedOrderOutPoints,
  summarizeBotState,
  transactionShape,
} from "./support.ts";
import type {
  BotActions,
  BotDecision,
  BotMatchReason,
  BotState,
  BuildTransactionResult,
  BuildTransactionSkipReason,
  Core,
  Runtime,
} from "./types.ts";

interface MatchOutcome {
  match: TurnMatch;
  tx: ccc.Transaction;
}

/**
 * One turn's transaction: the best match, then one rebalance core the completion walk can
 * fund (deposit first, then withdrawal chains, then none), with collections and the sweep
 * riding along. Matches and deposits are sized to keep the reserve; completion's fee and
 * marker cells draw on it, and nothing checks the completed transaction against it, since
 * such a check rejected every fill sized to the reserve (decisions amendment 52(i)).
 */
function matchReason(match: TurnMatch, state: BotState): BotMatchReason {
  if (match.partials.length > 0) {
    return "matched";
  }
  if (state.marketOrders.length === 0) {
    return "no_market_orders";
  }
  return match.gains > 0 ? "unfunded_gain" : "no_gain";
}

export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const matched = matchOutcome(runtime, state);
  const { match } = matched;
  const plan = planRebalance({
    tip: state.system.tip,
    ickb: state.ickb + match.udtDelta,
    ckb: state.ckb + match.ckbDelta,
    depositCost: state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
    poolDeposits: state.poolDeposits,
  });
  const hasCollections = state.receipts.length > 0 || state.readyWithdrawals.length > 0;
  const cores = candidateCores(plan, match.partials.length > 0 || hasCollections);
  const decision = (
    core: Core,
    attempts: number,
    tx?: ccc.Transaction,
    withdrawals = 0,
  ): BotDecision =>
    buildDecision({ state, matched, plan, core, attempts, tx, withdrawals });

  if (cores.length === 0) {
    return skipped("no_actions", decision({ kind: "none" }, 0));
  }

  let attempts = 0;
  let withdrawals = 0;
  let completion: FundableCompletion<Core>;
  try {
    completion = await completeFirstFundable(
      cores,
      (core) => {
        attempts += 1;
        const built = buildCore(runtime, state, matched, core);
        withdrawals = built.withdrawals;
        return built.tx;
      },
      async (tx) => runtime.completeTransaction(tx, state.system.feeRate, state.cells),
    );
  } catch (error) {
    if (!isFundabilityFailure(error)) {
      throw error;
    }
    return skipped("no_fundable_candidate", decision({ kind: "none" }, attempts));
  }
  const { candidate: core, tx } = completion;
  const built = decision(core, attempts, tx, withdrawals);
  return { kind: "built", tx, actions: built.actions, decision: built };
}

function matchOutcome(runtime: Runtime, state: BotState): MatchOutcome {
  const match = matchTurn({
    orders: state.marketOrders,
    ckb: matchableCkb(state.ckb),
    udt: state.ickb,
    exchangeRatio: state.system.exchangeRatio,
    feeRate: state.system.feeRate,
    seed: seedOf(state.system.tip.hash),
  });
  return { match, tx: runtime.managers.order.addMatch(ccc.Transaction.default(), match) };
}

/**
 * The cores to try in order: deposit first, then every withdrawal chain (the greedy fit from
 * the oldest candidate, longest prefix first, then the same rebuilt without the oldest), then
 * `none`, a candidate only when a match or a collection rides on it.
 */
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

/**
 * The match and every collection ride on each core; the builders mutate their input.
 * Returns how many ready withdrawals the transaction carries.
 */
function buildCore(
  runtime: Runtime,
  state: BotState,
  matched: MatchOutcome,
  core: Core,
): { tx: ccc.Transaction; withdrawals: number } {
  let tx = runtime.sdk.buildBaseTransaction(matched.tx.clone(), {
    ...(core.kind === "withdraw"
      ? { withdrawalRequest: { deposits: core.deposits, lock: runtime.primaryLock } }
      : {}),
    receipts: state.receipts,
  });
  // The deployed DAO script addresses a withdrawal's deposit header only below the index
  // limit, and the requests' and receipts' headers hold the first slots; the rest wait a turn.
  const readyWithdrawals = state.readyWithdrawals.slice(
    0,
    Math.max(0, DAO_HEADER_INDEX_LIMIT - tx.headerDeps.length),
  );
  tx = runtime.sdk.buildBaseTransaction(tx, { readyWithdrawals });
  if (core.kind === "deposit") {
    tx = runtime.managers.logic.deposit(
      tx,
      1,
      state.depositCapacity,
      runtime.primaryLock,
    );
  }
  return { tx, withdrawals: readyWithdrawals.length };
}

function buildDecision({
  state,
  matched,
  plan,
  core,
  attempts,
  tx,
  withdrawals,
}: {
  state: BotState;
  matched: MatchOutcome;
  plan: RebalancePlan;
  core: Core;
  attempts: number;
  tx?: ccc.Transaction;
  withdrawals: number;
}): BotDecision {
  const { match } = matched;
  const actions: BotActions = {
    matchedOrders: match.partials.length,
    deposits: core.kind === "deposit" ? 1 : 0,
    withdrawalRequests: core.kind === "withdraw" ? core.deposits.length : 0,
    completedDeposits: tx === undefined ? 0 : state.receipts.length,
    withdrawals,
  };
  return {
    ...summarizeBotState(state),
    match: {
      reason: matchReason(match, state),
      partialCount: match.partials.length,
      ckbDelta: match.ckbDelta,
      udtDelta: match.udtDelta,
      ...(match.partials.length === 0
        ? {}
        : { matchedOrderOutPoints: matchedOrderOutPoints(match.partials) }),
      candidates: match.candidates,
      gains: match.gains,
      fee: match.fee,
      seed: match.seed,
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
): BuildTransactionResult {
  return {
    kind: "skipped",
    reason,
    actions: decision.actions,
    decision: { ...decision, skip: { reason } },
  };
}
