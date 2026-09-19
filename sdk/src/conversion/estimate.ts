import type { IckbDepositCell } from "../logic.ts";
import {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "../order/conversion.ts";
import { ceilDiv, type ValueComponents } from "../utils/utils.ts";
import { maturity } from "./maturity.ts";
import type { ConversionOrderEstimate, SystemState } from "./types.ts";

/**
 * Default order-fee numerator used by Stack conversion quotes and plans: 0.01%, about two
 * days of DAO yield, which is how long a CKB-to-iCKB order stays fillable as the DAO ratio
 * grows past it (decisions amendment 52(z)).
 */
export const DEFAULT_ORDER_FEE = 10n;

/** Default order-fee denominator used by Stack conversion quotes and plans. */
export const DEFAULT_ORDER_FEE_BASE = 100000n;

/** The quote and its maturity estimate, or `undefined` when no order ratio represents it. */
export function estimateConversionOrder(
  isCkb2Udt: boolean,
  amounts: ValueComponents,
  system: SystemState,
  { fee, feeBase }: { fee: bigint; feeBase: bigint },
  takenDeposits: readonly IckbDepositCell[] = [],
): ConversionOrderEstimate | undefined {
  let quote: ReturnType<typeof quoteConversion>;
  try {
    quote = quoteConversion(isCkb2Udt, system.exchangeRatio, amounts, { fee, feeBase });
  } catch (error) {
    if (error instanceof OrderConversionRepresentabilityError) {
      return undefined;
    }
    throw error;
  }
  const estimatedMaturity =
    quote.ckbFee >= estimateMaturityFeeThreshold(system)
      ? maturity({ info: quote.info, amounts }, system, takenDeposits)
      : undefined;
  return { ...quote, maturity: estimatedMaturity };
}

/**
 * Returns the CKB fee threshold above which order maturity is worth estimating.
 */
export function estimateMaturityFeeThreshold(
  system: Pick<SystemState, "feeRate">,
): bigint {
  return 10n * system.feeRate;
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

/**
 * The order leg of an iCKB-to-CKB conversion: at the default fee when that fee clears the
 * maturity threshold, else the smallest fee that does (a dust order, noticed), else the
 * default-fee quote with a maturity-unavailable notice.
 */
export function estimateIckbToCkbOrder(
  amounts: ValueComponents,
  system: SystemState,
  takenDeposits: readonly IckbDepositCell[],
): ConversionOrderEstimate | undefined {
  const base = estimateConversionOrder(
    false,
    amounts,
    system,
    { fee: DEFAULT_ORDER_FEE, feeBase: DEFAULT_ORDER_FEE_BASE },
    takenDeposits,
  );
  if (base?.maturity !== undefined) {
    return base;
  }
  if (base !== undefined && base.ckbFee >= estimateMaturityFeeThreshold(system)) {
    return {
      ...base,
      notice: {
        kind: "maturity-unavailable",
        inputIckb: amounts.udtValue,
        outputCkb: base.convertedAmount,
        incentiveCkb: positiveFee(base.ckbFee),
        maturityEstimateUnavailable: true,
      },
    };
  }

  const dust = estimateDustIckbToCkbOrder(amounts, system);
  if (dust === undefined) {
    return undefined;
  }
  const estimatedMaturity = maturity({ info: dust.info, amounts }, system, takenDeposits);
  return {
    ...dust,
    maturity: estimatedMaturity,
    notice: {
      kind: "dust-ickb-to-ckb",
      inputIckb: amounts.udtValue,
      outputCkb: dust.convertedAmount,
      incentiveCkb: positiveFee(dust.ckbFee),
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
