import {
  DAO_OUTPUT_LIMIT,
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
} from "../core/index.ts";
import {
  ringSurplusDepositFilter,
  selectReadyWithdrawalDeposits,
} from "../core/withdrawal_selection.ts";
import { compareBigInt, maxBigInt } from "../utils/index.ts";
import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  estimateConversionOrder,
  estimateIckbToCkbOrder,
} from "./sdk_estimate.ts";
import type {
  CkbToIckbConversionPlan,
  ConversionOrder,
  ConversionTransactionOptions,
  IckbToCkbConversionPlan,
  PoolDepositState,
} from "./sdk_types.ts";
import {
  maturityBucket,
  readyPoolDeposits,
  sumDirectWithdrawalSurplus,
  sumUdtValue,
} from "./sdk_value_helpers.ts";

// The DAO script accepts 64 outputs per transaction. Planners start at the most the
// consensus limit can hold (one change output beside the deposits; a request and its
// owner marker per withdrawal) and the completion walk steps down from there when
// change and fees need more room (decisions amendment 52, finding N7).
const MAX_PLANNED_DEPOSITS = DAO_OUTPUT_LIMIT - 1;
const MAX_PLANNED_WITHDRAWAL_REQUESTS = DAO_OUTPUT_LIMIT / 2;

/** Plans every deposit count from the most the amount covers down to zero, skipping unrepresentable remainders. */
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
 * Plans every prefix of the greedy ready-deposit selection, longest first, ranked for the
 * completion walk. The prefix shape keeps ring classification frozen: a prefix of surplus
 * deposits stays surplus with the same anchors pinned (decisions amendments 40, 41, 46(a)).
 */
export function ickbToCkbConversionPlans(
  options: ConversionTransactionOptions,
  poolDeposits: PoolDepositState,
): IckbToCkbConversionPlan[] {
  const { amount, context } = options;
  const deposits = selectReadyWithdrawalDeposits({
    readyDeposits: readyPoolDeposits(poolDeposits, context.system.tip),
    tip: context.system.tip,
    maxAmount: amount,
    canSelectDeposit: ringSurplusDepositFilter(poolDeposits.deposits),
  });
  const plans: IckbToCkbConversionPlan[] = [];
  const longest = Math.min(deposits.length, MAX_PLANNED_WITHDRAWAL_REQUESTS);
  for (let count = longest; count >= 0; count -= 1) {
    const plan = ickbToCkbConversionPlan(options, deposits.slice(0, count));
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans.toSorted(compareIckbToCkbPlans);
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
  let remainder = amount;
  let directUdtValue = 0n;
  let directSurplusCkb = 0n;
  let order: ConversionOrder | undefined;

  if (selectedDeposits.length > 0) {
    directUdtValue = sumUdtValue(selectedDeposits);
    directSurplusCkb = sumDirectWithdrawalSurplus(
      selectedDeposits,
      context.system.exchangeRatio,
    );
    remainder -= directUdtValue;
    for (const deposit of selectedDeposits) {
      estimatedMaturity = maxBigInt(
        estimatedMaturity,
        deposit.maturity.toUnix(context.system.tip),
      );
    }
  }
  if (remainder > 0n) {
    const remainderOrder = orderForIckbRemainder(
      remainder,
      context.system,
      estimatedMaturity,
    );
    if (remainderOrder === undefined) {
      return undefined;
    }
    order = remainderOrder.order;
    estimatedMaturity = remainderOrder.estimatedMaturity;
  }

  return {
    directSurplusCkb,
    directUdtValue,
    estimatedMaturity,
    ...(order === undefined ? {} : { order }),
    selectedDeposits,
  };
}

function orderForIckbRemainder(
  remainder: bigint,
  system: ConversionTransactionOptions["context"]["system"],
  estimatedMaturity: bigint,
): { order: ConversionOrder; estimatedMaturity: bigint } | undefined {
  const amounts = { ckbValue: 0n, udtValue: remainder };
  const preview = estimateIckbToCkbOrder(amounts, system);
  if (preview === undefined) {
    return undefined;
  }
  const { estimate, maturity, notice } = preview;
  const updatedMaturity =
    maturity === undefined ? estimatedMaturity : maxBigInt(estimatedMaturity, maturity);
  return {
    order: {
      amounts,
      estimate,
      ...(notice === undefined ? {} : { conversionNotice: notice }),
    },
    estimatedMaturity: updatedMaturity,
  };
}

function compareIckbToCkbPlans(
  left: IckbToCkbConversionPlan,
  right: IckbToCkbConversionPlan,
): number {
  const maturityCompare = compareBigInt(
    maturityBucket(left.estimatedMaturity),
    maturityBucket(right.estimatedMaturity),
  );
  if (maturityCompare !== 0) {
    return maturityCompare;
  }
  const directPresenceCompare =
    Number(right.selectedDeposits.length > 0) - Number(left.selectedDeposits.length > 0);
  if (directPresenceCompare !== 0) {
    return directPresenceCompare;
  }
  const surplusCompare = compareBigInt(right.directSurplusCkb, left.directSurplusCkb);
  if (surplusCompare !== 0) {
    return surplusCompare;
  }
  // Prefixes of one list never tie on direct value; a stable sort keeps their order if they did.
  return compareBigInt(right.directUdtValue, left.directUdtValue);
}
