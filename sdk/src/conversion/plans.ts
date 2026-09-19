import { DAO_OUTPUT_LIMIT } from "../dao.ts";
import type { IckbDepositCell } from "../logic.ts";
import { ICKB_DEPOSIT_CAP, convert } from "../udt.ts";
import { maxBigInt } from "../utils/utils.ts";
import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  estimateConversionOrder,
  estimateIckbToCkbOrder,
} from "./estimate.ts";
import { sumUdt } from "./projection.ts";
import type {
  CkbToIckbConversionPlan,
  ConversionOrder,
  ConversionTransactionOptions,
  IckbToCkbConversionPlan,
} from "./types.ts";
import {
  readyPoolDeposits,
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "./withdrawal_ring.ts";

// The DAO script accepts 64 outputs per transaction. Planners start at the most the
// consensus limit can hold (one change output beside the deposits; a request and its
// owner marker per withdrawal) and the completion walk steps down from there when
// change and fees need more room (decisions amendment 52, finding N7).
const MAX_PLANNED_DEPOSITS = DAO_OUTPUT_LIMIT - 1;
const MAX_PLANNED_WITHDRAWAL_REQUESTS = DAO_OUTPUT_LIMIT / 2;

/**
 * Plans every deposit count from the most the amount covers down to zero, skipping
 * unrepresentable remainders. Cap-sized deposits plus an order for the rest is the cheapest
 * shape at every amount: a deposit's 82 CKB of occupied capacity goes to its withdrawer
 * (0.082% at the cap, 8.2% at the contract's 1,000 CKB minimum), the excess above the cap
 * is discounted 10%, and an order costs 0.01% at any size; the cap's CKB value grows with
 * the DAO rate, so the order stays cheaper until the cap is worth 820,000 CKB.
 */
export function ckbToIckbConversionPlans(
  options: ConversionTransactionOptions,
): CkbToIckbConversionPlan[] {
  const { amount, context } = options;
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, context.system.exchangeRatio);
  const depositQuotient = depositCapacity === 0n ? 0n : amount / depositCapacity;
  const maxDeposits =
    depositQuotient > BigInt(MAX_PLANNED_DEPOSITS)
      ? MAX_PLANNED_DEPOSITS
      : Number(depositQuotient);
  const plans: CkbToIckbConversionPlan[] = [];
  for (let depositCount = maxDeposits; depositCount >= 0; depositCount -= 1) {
    const plan = ckbToIckbConversionPlan(options, depositCapacity, depositCount);
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans;
}

/**
 * Plans every prefix of the greedy ready-deposit selection, longest first, the remainder as
 * an order: direct withdrawals are free and their claim date certain, an order pays a fee
 * and waits for the bot, so the completion walk takes the most direct plan it can fund
 * (decisions amendment 52(ak)). The prefix shape keeps ring classification frozen: a prefix
 * of surplus deposits stays surplus with the same anchors pinned (amendments 40, 41).
 */
export function ickbToCkbConversionPlans(
  options: ConversionTransactionOptions,
  poolDeposits: readonly IckbDepositCell[],
): IckbToCkbConversionPlan[] {
  const { amount, context } = options;
  const isSurplus = ringSurplusDepositFilter(poolDeposits);
  const deposits = selectReadyWithdrawalDeposits(
    readyPoolDeposits(poolDeposits, context.system.tip).filter(isSurplus),
    amount,
    context.system.tip,
  );
  const plans: IckbToCkbConversionPlan[] = [];
  const longest = Math.min(deposits.length, MAX_PLANNED_WITHDRAWAL_REQUESTS);
  for (let count = longest; count >= 0; count -= 1) {
    const plan = ickbToCkbConversionPlan(options, deposits.slice(0, count));
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans;
}

function ckbToIckbConversionPlan(
  options: ConversionTransactionOptions,
  depositCapacity: bigint,
  depositCount: number,
): CkbToIckbConversionPlan | undefined {
  const { amount, context } = options;
  const remainder = amount - depositCapacity * BigInt(depositCount);
  let estimatedMaturity = context.estimatedMaturity;
  let order: ConversionOrder | undefined;

  if (remainder > 0n) {
    const amounts = { ckbValue: remainder, udtValue: 0n };
    const estimate = estimateConversionOrder(true, amounts, context.system, {
      fee: DEFAULT_ORDER_FEE,
      feeBase: DEFAULT_ORDER_FEE_BASE,
    });
    if (estimate?.maturity === undefined) {
      return undefined;
    }
    estimatedMaturity = maxBigInt(estimatedMaturity, estimate.maturity);
    order = { amounts, estimate };
  }

  return {
    depositCapacity,
    depositCount,
    estimatedMaturity,
    ...(order === undefined ? {} : { order }),
  };
}

function ickbToCkbConversionPlan(
  options: ConversionTransactionOptions,
  selectedDeposits: IckbDepositCell[],
): IckbToCkbConversionPlan | undefined {
  const { amount, context } = options;
  let estimatedMaturity = context.estimatedMaturity;
  for (const deposit of selectedDeposits) {
    estimatedMaturity = maxBigInt(
      estimatedMaturity,
      deposit.maturity.toUnix(context.system.tip),
    );
  }
  const remainder = amount - sumUdt(selectedDeposits);
  let order: ConversionOrder | undefined;
  if (remainder > 0n) {
    const amounts = { ckbValue: 0n, udtValue: remainder };
    // The deposits this plan withdraws directly cannot fill its order leg too.
    const estimate = estimateIckbToCkbOrder(amounts, context.system, selectedDeposits);
    if (estimate === undefined) {
      return undefined;
    }
    if (estimate.maturity !== undefined) {
      estimatedMaturity = maxBigInt(estimatedMaturity, estimate.maturity);
    }
    order = { amounts, estimate };
  }

  return {
    estimatedMaturity,
    ...(order === undefined ? {} : { order }),
    selectedDeposits,
  };
}
