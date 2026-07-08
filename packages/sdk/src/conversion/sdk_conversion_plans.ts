import { ICKB_DEPOSIT_CAP, convert, type IckbDepositCell } from "@ickb/core";
import { compareBigInt } from "@ickb/utils";
import {
  MAX_DIRECT_DEPOSITS,
  MAX_WITHDRAWAL_REQUESTS,
  type CkbToIckbConversionPlan,
  type ConversionOrder,
  type ConversionTransactionFailureReason,
  type ConversionTransactionOptions,
  type IckbToCkbConversionPlan,
  type PoolDepositState,
} from "../client/sdk_types.ts";
import {
  estimateConversionOrder,
  estimateIckbToCkbOrder,
  maxMaturity,
} from "../estimate/sdk_estimate.ts";
import {
  ringRequiredLiveDepositFor,
  ringSurplusDepositFilter,
  selectExactReadyWithdrawalDepositCandidates,
} from "../withdrawal/withdrawal_selection.ts";
import {
  directWithdrawalSurplus,
  maturityBucket,
  normalizeCountLimit,
  sortDepositsByMaturity,
  sumDirectWithdrawalSurplus,
  sumUdtValue,
} from "./sdk_value_helpers.ts";

export function ckbToIckbConversionPlans(options: ConversionTransactionOptions): {
  lastFailure: ConversionTransactionFailureReason | undefined;
  plans: CkbToIckbConversionPlan[];
} {
  const { amount, context } = options;
  const maxDirectDeposits = normalizeCountLimit(
    options.limits?.maxDirectDeposits ?? MAX_DIRECT_DEPOSITS,
  );
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, context.system.exchangeRatio);
  const depositQuotient = depositCapacity === 0n ? 0n : amount / depositCapacity;
  const maxDeposits =
    depositQuotient > BigInt(maxDirectDeposits)
      ? maxDirectDeposits
      : Number(depositQuotient);
  const plans: CkbToIckbConversionPlan[] = [];
  let lastFailure: ConversionTransactionFailureReason | undefined;

  for (let depositCount = maxDeposits; depositCount >= 0; depositCount -= 1) {
    const plan = ckbToIckbConversionPlan(options, depositCapacity, depositCount);
    if (plan === undefined) {
      lastFailure = "amount-too-small";
      continue;
    }
    plans.push(plan);
  }

  return { lastFailure, plans };
}

export function ickbToCkbConversionPlans(
  options: ConversionTransactionOptions,
  poolDeposits: PoolDepositState,
): {
  lastFailure: ConversionTransactionFailureReason | undefined;
  plans: IckbToCkbConversionPlan[];
} {
  const { amount, context } = options;
  const maxWithdrawalRequests = normalizeCountLimit(
    options.limits?.maxWithdrawalRequests ?? MAX_WITHDRAWAL_REQUESTS,
  );
  const readyDeposits = sortDepositsByMaturity(
    poolDeposits.deposits.filter((deposit) => deposit.isReady),
    context.system.tip,
  );
  const ringSurplus = ringSurplusDepositFilter(poolDeposits.deposits);
  const ringRequiredLiveDeposit = ringRequiredLiveDepositFor(poolDeposits.deposits);
  const plans: IckbToCkbConversionPlan[] = [];
  let lastFailure: ConversionTransactionFailureReason | undefined;

  for (
    let count = Math.min(readyDeposits.length, maxWithdrawalRequests);
    count >= 0;
    count -= 1
  ) {
    const selections = selectionsForWithdrawalCount({
      options,
      readyDeposits,
      count,
      amount,
      canSelectDeposit: ringSurplus,
      requiredLiveDepositFor: ringRequiredLiveDeposit,
    });
    if (count > 0 && selections.length === 0) {
      lastFailure = "not-enough-ready-deposits";
      continue;
    }
    for (const selection of selections) {
      const plan = ickbToCkbConversionPlan(
        options,
        selection.deposits,
        selection.requiredLiveDeposits,
      );
      if (plan === undefined) {
        lastFailure = "amount-too-small";
        continue;
      }
      plans.push(plan);
    }
  }

  return { lastFailure, plans: plans.toSorted(compareIckbToCkbPlans) };
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
    const estimate = estimateConversionOrder(true, amounts, context.system, 1n, 100000n);
    if (estimate?.maturity === undefined) {
      return undefined;
    }
    estimatedMaturity = maxMaturity(estimatedMaturity, estimate.maturity);
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
  requiredLiveDeposits: IckbDepositCell[],
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
      estimatedMaturity = maxMaturity(
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
    requiredLiveDeposits,
    selectedDeposits,
  };
}

function selectionsForWithdrawalCount({
  options,
  readyDeposits,
  count,
  amount,
  canSelectDeposit,
  requiredLiveDepositFor,
}: {
  options: ConversionTransactionOptions;
  readyDeposits: IckbDepositCell[];
  count: number;
  amount: bigint;
  canSelectDeposit: (deposit: IckbDepositCell) => boolean;
  requiredLiveDepositFor: (deposit: IckbDepositCell) => IckbDepositCell | undefined;
}): Array<{ deposits: IckbDepositCell[]; requiredLiveDeposits: IckbDepositCell[] }> {
  return count === 0
    ? [{ deposits: [], requiredLiveDeposits: [] }]
    : selectExactReadyWithdrawalDepositCandidates({
        readyDeposits,
        tip: options.context.system.tip,
        maxAmount: amount,
        count,
        canSelectDeposit,
        requiredLiveDepositFor,
        score: (deposit) =>
          directWithdrawalSurplus(deposit, options.context.system.exchangeRatio),
        maturityBucket: (deposit) =>
          maturityBucket(deposit.maturity.toUnix(options.context.system.tip)),
      });
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
    maturity === undefined ? estimatedMaturity : maxMaturity(estimatedMaturity, maturity);
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
  const directCompare = compareBigInt(right.directUdtValue, left.directUdtValue);
  return directCompare !== 0
    ? directCompare
    : right.selectedDeposits.length - left.selectedDeposits.length;
}
