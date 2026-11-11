import { ccc } from "@ckb-ccc/core";
import { buildBaseTransaction } from "../../../src/build.ts";
import { completeFirstFundable } from "../../../src/complete.ts";
import { sumCkb } from "../../../src/conversion/projection.ts";
import type { State } from "../../../src/conversion/types.ts";
import { fitWithdrawalDeposits } from "../../../src/conversion/withdrawal_ring.ts";
import { broadcastDeadline } from "../../../src/dao.ts";
import { deposit, receiptPhase2Capacity } from "../../../src/logic.ts";
import { addMatch } from "../../../src/order/order.ts";

import { transactionShape } from "../shared/format.ts";
import { matchTurn, seedOf, type TurnMatch } from "./match.ts";
import { planRebalance, spendableCkb, type RebalancePlan } from "./policy.ts";
import type {
  BotActions,
  BotDecision,
  BotMatchReason,
  BuildTransactionResult,
  BuildTransactionSkipReason,
  Core,
  Runtime,
} from "./types.ts";

interface MatchOutcome {
  match: TurnMatch;
  tx: ccc.Transaction;
}

function matchReason(match: TurnMatch, state: State): BotMatchReason {
  if (match.partials.length > 0) {
    return "matched";
  }
  if (state.orderBook.length === 0) {
    return "no_market_orders";
  }
  return match.gains > 0 ? "unfunded_gain" : "no_gain";
}

/**
 * One turn's transaction: the best match, then one rebalance core the completion walk can
 * fund (deposit first, then withdrawal chains, then none), with collections and the offered
 * cells riding along. Matches and deposits are sized to keep at least the reserve; completion's fee, the
 * receipt, and the iCKB change cell when no iCKB cell was offered draw on it by a bounded
 * amount, withdrawal owner markers by chain length (at most DAO_OUTPUT_LIMIT / 2), and nothing
 * checks the completed transaction against it, since such a check rejected every fill
 * sized to the reserve.
 */
export async function buildTransaction(
  runtime: Runtime,
  state: State,
): Promise<BuildTransactionResult> {
  const matched = matchOutcome(state);
  const { match } = matched;
  const plan = planRebalance({
    tip: state.tip,
    lockUp: state.lockUp,
    ickb: state.ickbAvailable + match.udtDelta,
    ckb: state.ckbAvailable + match.ckbDelta,
    pendingCkb: sumCkb(state.pendingWithdrawals),
    depositCost: state.depositCapacity + receiptPhase2Capacity(state.changeLock),
    poolDeposits: state.poolDeposits,
  });
  // A liquid cell at any lock but the primary one (the change lock), another key's or an
  // anyone-can-pay lock's, is worth a transaction on its own: completion moves it there, where
  // cells already there would only compact.
  const hasMove = state.cells.some(
    ({ cellOutput }) => !cellOutput.lock.eq(state.changeLock),
  );
  const cores = candidateCores(
    plan,
    match.partials.length > 0 || state.hasCollectable || hasMove,
  );
  const decision = (
    core: Core,
    attempts: number,
    built?: { tx: ccc.Transaction; plannedFee: bigint },
  ): BotDecision => buildDecision({ state, matched, plan, core, attempts, built });

  if (cores.length === 0) {
    return skipped("no_actions", decision({ kind: "none" }, 0));
  }

  let attempts = 0;
  const completion = await completeFirstFundable(
    cores,
    (core) => {
      attempts += 1;
      return buildCore(state, matched, core);
    },
    async (tx) => runtime.completeTransaction(tx, state),
  );
  if (!completion.ok) {
    return skipped("no_fundable_candidate", decision({ kind: "none" }, attempts));
  }
  const { candidate: core, tx, plannedFee } = completion;
  const broadcastBefore =
    core.kind === "withdraw"
      ? broadcastDeadline(
          core.deposits.map(({ claimEpoch }) => claimEpoch),
          state.lockUp,
        )
      : undefined;
  return {
    kind: "built",
    tx,
    plannedFee,
    decision: decision(core, attempts, { tx, plannedFee }),
    ...(broadcastBefore === undefined ? {} : { broadcastBefore }),
  };
}

function matchOutcome(state: State): MatchOutcome {
  const match = matchTurn({
    orders: state.orderBook,
    ckb: spendableCkb(state.ckbAvailable),
    udt: state.ickbAvailable,
    exchangeRatio: state.exchangeRatio,
    feeRate: state.feeRate,
    seed: seedOf(state.tip.hash),
  });
  return { match, tx: addMatch(ccc.Transaction.default(), match) };
}

/**
 * The cores to try in order: deposit first, then every withdrawal chain (the greedy fit from
 * the oldest candidate, longest prefix first), then `none`, a candidate only when a match,
 * a collection or a move to the primary lock rides on it.
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
 * from a later start would only fund where this one's prefixes did not when the account's
 * iCKB lies past one transaction's share of cells; trying every start
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
function buildCore(state: State, matched: MatchOutcome, core: Core): ccc.Transaction {
  let tx = buildBaseTransaction(
    matched.tx.clone(),
    state,
    core.kind === "withdraw"
      ? { deposits: core.deposits, lock: state.changeLock }
      : undefined,
  );
  if (core.kind === "deposit") {
    tx = deposit(tx, 1, state.depositCapacity, state.changeLock);
  }
  return tx;
}

function buildDecision({
  state,
  matched,
  plan,
  core,
  attempts,
  built,
}: {
  state: State;
  matched: MatchOutcome;
  plan: RebalancePlan;
  core: Core;
  attempts: number;
  built?: { tx: ccc.Transaction; plannedFee: bigint };
}): BotDecision {
  const { match } = matched;
  const actions: BotActions = {
    matchedOrders: match.partials.length,
    deposits: core.kind === "deposit" ? 1 : 0,
    withdrawalRequests: core.kind === "withdraw" ? core.deposits.length : 0,
    completedDeposits: built === undefined ? 0 : state.receipts.length,
    withdrawals: built === undefined ? 0 : state.readyWithdrawals.length,
  };
  return {
    match: {
      reason: matchReason(match, state),
      partialCount: match.partials.length,
      ckbDelta: match.ckbDelta,
      udtDelta: match.udtDelta,
      ...(match.partials.length === 0
        ? {}
        : {
            matchedOrderOutPoints: match.partials.map(({ group }) => ({
              txHash: group.order.cell.outPoint.txHash,
              index: String(group.order.cell.outPoint.index),
            })),
          }),
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
    core: { kind: core.kind, attempts },
    actions,
    ...(built === undefined
      ? {}
      : { plannedFee: built.plannedFee, transactionShape: transactionShape(built.tx) }),
  };
}

function skipped(
  reason: BuildTransactionSkipReason,
  decision: BotDecision,
): BuildTransactionResult {
  return { kind: "skipped", reason, decision };
}
