import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  isFundabilityFailure,
} from "../../../src/conversion/fundable_walk.ts";
import { fitWithdrawalDeposits } from "../../../src/conversion/withdrawal_ring.ts";
import { broadcastDeadline } from "../../../src/dao.ts";
import { receiptPhase2Capacity } from "../../../src/logic.ts";

import { transactionShape } from "../shared/format.ts";
import { matchTurn, seedOf, type TurnMatch } from "./match.ts";
import { planRebalance, type RebalancePlan } from "./policy.ts";
import { matchableCkb, matchedOrderOutPoints, summarizeBotState } from "./support.ts";
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

function matchReason(match: TurnMatch, state: BotState): BotMatchReason {
  if (match.partials.length > 0) {
    return "matched";
  }
  if (state.marketOrders.length === 0) {
    return "no_market_orders";
  }
  return match.gains > 0 ? "unfunded_gain" : "no_gain";
}

/**
 * One turn's transaction: the best match, then one rebalance core the completion walk can
 * fund (deposit first, then withdrawal chains, then none), with collections and the sweep
 * riding along. Matches and deposits are sized to keep the reserve; completion's fee, the
 * receipt, and the iCKB change cell when no iCKB cell was swept in draw on it by a bounded
 * amount, withdrawal owner markers by chain length (chains are sized in iCKB), and nothing
 * checks the completed transaction against it, since such a check rejected every fill
 * sized to the reserve (decisions amendment 52(i)).
 */
export async function buildTransaction(
  runtime: Runtime,
  state: BotState,
): Promise<BuildTransactionResult> {
  const matched = matchOutcome(runtime, state);
  const { match } = matched;
  const plan = planRebalance({
    tip: state.system.tip,
    lockUp: state.system.lockUp,
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
    return skipped("no_actions", decision({ kind: "none" }, 0));
  }

  let attempts = 0;
  let completion: Awaited<ReturnType<typeof completeFirstFundable<Core>>>;
  try {
    completion = await completeFirstFundable(
      cores,
      (core) => {
        attempts += 1;
        return buildCore(runtime, state, matched, core);
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
  const broadcastBefore =
    core.kind === "withdraw"
      ? broadcastDeadline(
          core.deposits.map((deposit) => deposit.claimEpoch),
          state.system.lockUp,
        )
      : undefined;
  return {
    kind: "built",
    tx,
    decision: decision(core, attempts, tx),
    ...(broadcastBefore === undefined ? {} : { broadcastBefore }),
  };
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
 * the oldest candidate, longest prefix first), then `none`, a candidate only when a match or
 * a collection rides on it.
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
 * Every prefix of the greedy chain, longest first, so completion can fall back to a shorter
 * one. One chain only: a shorter prefix needs fewer markers and less iCKB, and a chain
 * from a later start would only fund where this one's prefixes did not when the sweep
 * cannot reach iCKB the projection counted (decisions amendment 52(y)); trying every start
 * made the walk quadratic in ready deposits.
 */
function withdrawalCores({
  candidates,
  budget,
  stress,
}: NonNullable<RebalancePlan["withdrawal"]>): Core[] {
  const chain = fitWithdrawalDeposits(candidates, budget);
  return chain.map((_, index) => ({
    kind: "withdraw",
    deposits: chain.slice(0, chain.length - index),
    stress,
  }));
}

/**
 * The match and every collection ride on each core; the builders mutate their input. The
 * projection already sized the ready batch to what the DAO script's deposit-header index
 * addresses, and the withdrawals' deposit headers go first, so a request never displaces
 * a collected withdrawal.
 */
function buildCore(
  runtime: Runtime,
  state: BotState,
  matched: MatchOutcome,
  core: Core,
): ccc.Transaction {
  let tx = runtime.sdk.buildBaseTransaction(
    matched.tx.clone(),
    {
      availableOrders: [],
      receipts: state.receipts,
      readyWithdrawals: state.readyWithdrawals,
    },
    core.kind === "withdraw"
      ? { deposits: core.deposits, lock: runtime.primaryLock }
      : undefined,
  );
  if (core.kind === "deposit") {
    tx = runtime.managers.ickbLogic.deposit(
      tx,
      1,
      state.depositCapacity,
      runtime.primaryLock,
    );
  }
  return tx;
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
  const { match } = matched;
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
  return { kind: "skipped", reason, decision: { ...decision, skip: { reason } } };
}
