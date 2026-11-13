import { ccc } from "@ckb-ccc/core";
import { DAO_OUTPUT_LIMIT } from "../dao.ts";
import { readyDeposits, type DepositCell } from "../logic.ts";
import type { ValueComponents } from "../utils/utils.ts";
import {
  estimateConversionOrder,
  estimateIckbToCkbOrder,
  type ConversionOrderEstimate,
} from "./estimate.ts";
import { sumUdt } from "./projection.ts";
import type { State } from "./types.ts";
import {
  fitWithdrawalDeposits,
  ringSurplusDepositFilter,
  sortByClaim,
} from "./withdrawal_ring.ts";

export interface ConversionOrder {
  amounts: ValueComponents;
  estimate: ConversionOrderEstimate;
}

/**
 * One candidate conversion: its direct part, deposits of the state's `depositCapacity` for
 * CKB to iCKB or the selected deposits' withdrawal requests for iCKB to CKB, the other
 * empty, and the order for the rest.
 */
export interface ConversionPlan {
  depositCount: number;
  selectedDeposits: DepositCell[];
  estimatedMaturity: bigint;
  order: ConversionOrder;
}

// The planners start at the most `DAO_OUTPUT_LIMIT` holds beside the outputs every such
// conversion adds. Deposits: the receipt, the order, its master and the CKB change, so
// 60; an iCKB change output, when the account's iCKB exceeds what the outputs need, takes
// one more, and the completion walk steps down to 59. Withdrawal requests, a request and
// its owner marker each: the order, its master, the CKB change and the iCKB change, so 30.
const MAX_PLANNED_DEPOSITS = DAO_OUTPUT_LIMIT - 4;
const MAX_PLANNED_REQUESTS = (DAO_OUTPUT_LIMIT - 4) / 2;

/**
 * Plans every deposit count from the most the amount covers down to zero, skipping
 * unrepresentable remainders and, since every conversion mints an order (see
 * {@link ckbToIckbConversionPlan}), a count that leaves none: an exact multiple of
 * `depositCapacity` converts with one deposit fewer. Cap-sized deposits plus an order for the rest is the cheapest
 * shape at every amount: a deposit's 82 CKB of occupied capacity goes to its withdrawer
 * (0.082% at the cap, 8.2% at the contract's 1,000 CKB minimum), the excess above the cap
 * is discounted 10%, and an order costs 0.01% at any size; the cap's CKB value grows with
 * the DAO rate, so the order stays cheaper until the cap is worth 820,000 CKB.
 */
export function ckbToIckbConversionPlans(state: State, amount: bigint): ConversionPlan[] {
  const { depositCapacity } = state;
  const depositQuotient = depositCapacity === 0n ? 0n : amount / depositCapacity;
  const maxDeposits = Number(ccc.numMin(depositQuotient, BigInt(MAX_PLANNED_DEPOSITS)));
  const plans: ConversionPlan[] = [];
  for (let depositCount = maxDeposits; depositCount >= 0; depositCount -= 1) {
    const plan = ckbToIckbConversionPlan(state, amount, depositCount);
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans;
}

/**
 * Plans every prefix of the greedy ready-deposit selection, longest first, the remainder as
 * an order: direct withdrawals are free and their claim date certain, an order pays a fee
 * and waits for the bot, so the completion walk takes the most direct plan it can fund. A
 * prefix that would leave no order is skipped, so the next one, a deposit shorter, carries it.
 * The prefix shape keeps ring classification frozen: a prefix of surplus deposits stays
 * surplus with the same anchors pinned.
 */
export function ickbToCkbConversionPlans(state: State, amount: bigint): ConversionPlan[] {
  const { tip, lockUp, poolDeposits } = state;
  const ready = readyDeposits(poolDeposits, tip, lockUp);
  const isSurplus = ringSurplusDepositFilter(poolDeposits, ready);
  const deposits = fitWithdrawalDeposits(
    sortByClaim(ready.filter(isSurplus)),
    amount,
    MAX_PLANNED_REQUESTS,
  );
  const plans: ConversionPlan[] = [];
  for (let count = deposits.length; count >= 0; count -= 1) {
    const plan = ickbToCkbConversionPlan(state, amount, deposits.slice(0, count));
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans;
}

/**
 * A plan of `depositCount` deposits and an order for the remainder, or none when the
 * remainder is zero or unrepresentable.
 *
 * @remarks Every user conversion mints an order: its CKB goes to the bot, which is
 * usually short of it, and a conversion of deposits alone would leave the bot nothing to
 * fill. Collections and the bot's own transactions are not conversions and mint none.
 */
function ckbToIckbConversionPlan(
  state: State,
  amount: bigint,
  depositCount: number,
): ConversionPlan | undefined {
  // A zero remainder quotes as unrepresentable (quoteOrder), so this drops the plan too.
  const amounts = {
    ckbValue: amount - state.depositCapacity * BigInt(depositCount),
    udtValue: 0n,
  };
  const estimate = estimateConversionOrder(true, amounts, state);
  if (estimate?.maturity === undefined) {
    return undefined;
  }
  return {
    depositCount,
    selectedDeposits: [],
    // The conversion's own date: what the wallet already has converting is the state's.
    estimatedMaturity: ccc.numMax(state.tip.timestamp, estimate.maturity),
    order: { amounts, estimate },
  };
}

function ickbToCkbConversionPlan(
  state: State,
  amount: bigint,
  selectedDeposits: DepositCell[],
): ConversionPlan | undefined {
  let estimatedMaturity = state.tip.timestamp;
  // Selected deposits are ready, so their sampled claim is their date: depositMaturity
  // never reads a rolled claim as ready, whatever the policy window.
  for (const deposit of selectedDeposits) {
    estimatedMaturity = ccc.numMax(
      estimatedMaturity,
      deposit.claimEpoch.toUnix(state.tip),
    );
  }
  // Every user conversion mints an order (see ckbToIckbConversionPlan); a zero remainder
  // quotes as unrepresentable, so the estimate drops this plan.
  const amounts = { ckbValue: 0n, udtValue: amount - sumUdt(selectedDeposits) };
  // The deposits this plan withdraws directly cannot fill its order leg too.
  const estimate = estimateIckbToCkbOrder(amounts, state, selectedDeposits);
  if (estimate === undefined) {
    return undefined;
  }
  return {
    depositCount: 0,
    selectedDeposits,
    estimatedMaturity: ccc.numMax(estimatedMaturity, estimate.maturity),
    order: { amounts, estimate },
  };
}
