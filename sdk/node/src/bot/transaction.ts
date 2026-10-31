import { ccc } from "@ckb-ccc/core";
import { fitWithdrawalDeposits } from "../../../src/conversion/withdrawal_ring.ts";
import { broadcastDeadline } from "../../../src/dao.ts";
import { receiptPhase2Capacity } from "../../../src/logic.ts";
import { completeFirstFundable, isFundabilityFailure } from "../../../src/sdk.ts";

import { transactionShape } from "../shared/format.ts";
import { matchTurn, seedOf, type TurnMatch } from "./match.ts";
import { planRebalance, spendableCkb, type RebalancePlan } from "./policy.ts";
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
  if (state.system.orderPool.length === 0) {
    return "no_market_orders";
  }
  return match.gains > 0 ? "unfunded_gain" : "no_gain";
}

/**
 * One turn's transaction: the best match, then one rebalance core the completion walk can
 * fund (deposit first, then withdrawal chains, then none), with collections and the sweep
 * riding along. Matches and deposits are sized to keep at least the reserve; completion's fee, the
 * receipt, and the iCKB change cell when no iCKB cell was swept in draw on it by a bounded
 * amount, withdrawal owner markers by chain length (at most DAO_OUTPUT_LIMIT / 2), and nothing
 * checks the completed transaction against it, since such a check rejected every fill
 * sized to the reserve.
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
    ickb: state.ickbAvailable + match.udtDelta,
    ckb: state.ckbAvailable + match.ckbDelta,
    pendingCkb: state.pendingCkb,
    depositCost:
      state.system.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
    poolDeposits: state.system.poolDeposits,
  });
  const hasCollections = state.receipts.length > 0 || state.readyWithdrawals.length > 0;
  // A liquid cell at any lock but the primary one, another key's or an anyone-can-pay
  // lock's, is worth a transaction on its own: the sweep moves it to the primary lock, where
  // cells already there would only compact.
  const hasMove = state.cells.some(
    ({ cellOutput }) => !cellOutput.lock.eq(runtime.primaryLock),
  );
  const cores = candidateCores(
    plan,
    match.partials.length > 0 || hasCollections || hasMove,
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
  let completion: Awaited<ReturnType<typeof completeFirstFundable<Core>>>;
  try {
    completion = await completeFirstFundable(
      cores,
      (core) => {
        attempts += 1;
        return buildCore(runtime, state, matched, core);
      },
      async (tx) => runtime.completeTransaction(tx, state),
    );
  } catch (error) {
    if (!isFundabilityFailure(error)) {
      throw error;
    }
    return skipped("no_fundable_candidate", decision({ kind: "none" }, attempts));
  }
  const { candidate: core, tx, plannedFee } = completion;
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
    plannedFee,
    decision: decision(core, attempts, { tx, plannedFee }),
    ...(broadcastBefore === undefined ? {} : { broadcastBefore }),
  };
}

function matchOutcome(runtime: Runtime, state: BotState): MatchOutcome {
  const match = matchTurn({
    orders: state.system.orderPool,
    ckb: spendableCkb(state.ckbAvailable),
    udt: state.ickbAvailable,
    exchangeRatio: state.system.exchangeRatio,
    feeRate: state.system.feeRate,
    seed: seedOf(state.system.tip.hash),
  });
  return { match, tx: runtime.managers.order.addMatch(ccc.Transaction.default(), match) };
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
 * from a later start would only fund where this one's prefixes did not when the sweep
 * cannot reach iCKB the projection counted; trying every start
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
    state,
    core.kind === "withdraw"
      ? { deposits: core.deposits, lock: runtime.primaryLock }
      : undefined,
  );
  if (core.kind === "deposit") {
    tx = runtime.managers.ickbLogic.deposit(
      tx,
      1,
      state.system.depositCapacity,
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
  built,
}: {
  state: BotState;
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
