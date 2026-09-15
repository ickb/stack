import type { ccc } from "@ckb-ccc/core";
import { OrderConversionRepresentabilityError } from "../order/index.ts";
import { ceilDiv } from "../order/matching/order_conversion.ts";
import type { ValueComponents } from "../utils/index.ts";
import {
  estimateConversionOrder,
  estimateMaturityFeeThreshold,
} from "./sdk_estimate_core.ts";
import { maturity } from "./sdk_maturity.ts";
import { maxMaturity } from "./sdk_projection.ts";
import type {
  ConversionOrderEstimate,
  IckbToCkbOrderEstimate,
  SystemState,
} from "./sdk_types.ts";

/**
 * Default order-fee numerator used by Stack conversion quotes and plans: 0.01%, about two
 * days of DAO yield, which is how long a CKB-to-iCKB order stays fillable as the DAO ratio
 * grows past it (decisions amendment 52(z)).
 */
export const DEFAULT_ORDER_FEE = 10n;

/** Default order-fee denominator used by Stack conversion quotes and plans. */
export const DEFAULT_ORDER_FEE_BASE = 100000n;

export function estimate(
  isCkb2Udt: boolean,
  amounts: ValueComponents,
  system: SystemState,
  options?: { fee?: ccc.Num; feeBase?: ccc.Num },
): ConversionOrderEstimate {
  const conversion = estimateConversionOrder(isCkb2Udt, amounts, system, {
    fee: DEFAULT_ORDER_FEE,
    feeBase: DEFAULT_ORDER_FEE_BASE,
    ...options,
  });
  if (conversion === undefined) {
    throw new OrderConversionRepresentabilityError();
  }

  return conversion;
}

/**
 * The smallest request one direction accepts as an order at the current fee rate. A
 * CKB-to-iCKB remainder pays the default order fee, which must cover the maturity threshold
 * of ten mining fees; an iCKB-to-CKB remainder can give its whole CKB value as the dust
 * fee, so its value must exceed the threshold. The extra unit covers the quote's rounding,
 * as the dust search's boundary shows; callers round up further for display.
 */
export function minimumOrderAmount(isCkb2Udt: boolean, system: SystemState): bigint {
  const threshold = estimateMaturityFeeThreshold(system) + 1n;
  if (isCkb2Udt) {
    return ceilDiv(threshold * DEFAULT_ORDER_FEE_BASE, DEFAULT_ORDER_FEE);
  }
  const { ckbScale, udtScale } = system.exchangeRatio;
  return ceilDiv(threshold * ckbScale, udtScale);
}

export function estimateIckbToCkbOrder(
  amounts: { ckbValue: bigint; udtValue: bigint },
  system: SystemState,
): IckbToCkbOrderEstimate | undefined {
  const baseEstimate = estimateIckbToCkbOrderDefaultFee(amounts, system);
  if (baseEstimate === undefined) {
    const dustEstimate = estimateDustIckbToCkbOrder(amounts, system);
    return dustEstimate === undefined
      ? undefined
      : dustIckbToCkbOrderEstimate(amounts, system, dustEstimate);
  }
  if (baseEstimate.maturity !== undefined) {
    return { estimate: baseEstimate, maturity: baseEstimate.maturity };
  }
  if (baseEstimate.ckbFee >= estimateMaturityFeeThreshold(system)) {
    return {
      estimate: baseEstimate,
      maturity: undefined,
      notice: {
        kind: "maturity-unavailable",
        inputIckb: amounts.udtValue,
        outputCkb: baseEstimate.convertedAmount,
        incentiveCkb: positiveFee(baseEstimate.ckbFee),
        maturityEstimateUnavailable: true,
      },
    };
  }

  const dustEstimate = estimateDustIckbToCkbOrder(amounts, system);
  return dustEstimate === undefined
    ? undefined
    : dustIckbToCkbOrderEstimate(amounts, system, dustEstimate);
}

export { estimateConversionOrder } from "./sdk_estimate_core.ts";
export { maxMaturity };

function estimateIckbToCkbOrderDefaultFee(
  amounts: ValueComponents,
  system: SystemState,
): ConversionOrderEstimate | undefined {
  return estimateConversionOrder(false, amounts, system, {
    fee: DEFAULT_ORDER_FEE,
    feeBase: DEFAULT_ORDER_FEE_BASE,
  });
}

function dustIckbToCkbOrderEstimate(
  amounts: ValueComponents,
  system: SystemState,
  orderEstimate: ConversionOrderEstimate,
): IckbToCkbOrderEstimate {
  const estimatedMaturity = maturity({ info: orderEstimate.info, amounts }, system);

  return {
    estimate: orderEstimate,
    maturity: estimatedMaturity,
    notice: {
      kind: "dust-ickb-to-ckb",
      inputIckb: amounts.udtValue,
      outputCkb: orderEstimate.convertedAmount,
      incentiveCkb: positiveFee(orderEstimate.ckbFee),
      maturityEstimateUnavailable: estimatedMaturity === undefined,
    },
  };
}

function estimateDustIckbToCkbOrder(
  amounts: ValueComponents,
  system: SystemState,
): ConversionOrderEstimate | undefined {
  const baseEstimate = estimateConversionOrder(false, amounts, system, {
    fee: 0n,
    feeBase: DEFAULT_ORDER_FEE_BASE,
  });
  if (baseEstimate === undefined) {
    return undefined;
  }
  const targetFee = estimateMaturityFeeThreshold(system);
  const feeBase = baseEstimate.convertedAmount + 1n;
  if (targetFee <= 0n || feeBase <= 1n) {
    return baseEstimate;
  }
  const estimateWithFee = (fee: bigint): ConversionOrderEstimate | undefined =>
    estimateConversionOrder(false, amounts, system, { fee, feeBase });
  return lowestFeeEstimateAtThreshold(estimateWithFee, feeBase - 1n, targetFee);
}

function lowestFeeEstimateAtThreshold(
  estimateWithFee: (fee: bigint) => ConversionOrderEstimate | undefined,
  highestFee: bigint,
  targetFee: bigint,
): ConversionOrderEstimate | undefined {
  const highestDiscount = estimateWithFee(highestFee);
  if (highestDiscount === undefined || highestDiscount.ckbFee < targetFee) {
    return undefined;
  }

  let low = 0n;
  let high = highestFee;
  while (low < high) {
    const mid = (low + high) / 2n;
    const estimateAtMid = estimateWithFee(mid);
    if (estimateAtMid === undefined) {
      return undefined;
    }
    if (estimateAtMid.ckbFee >= targetFee) {
      high = mid;
    } else {
      low = mid + 1n;
    }
  }
  return estimateWithFee(low);
}

function positiveFee(fee: bigint): bigint {
  return fee > 0n ? fee : 0n;
}
