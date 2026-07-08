import type { ccc } from "@ckb-ccc/core";
import { OrderConversionRepresentabilityError } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import type {
  ConversionOrderEstimate,
  IckbToCkbOrderEstimate,
  SystemState,
} from "../client/sdk_types.ts";
import {
  estimateConversionOrder,
  estimateMaturityFeeThreshold,
} from "./sdk_estimate_core.ts";
import { maturity } from "./sdk_maturity.ts";
import { maxMaturity } from "./sdk_projection.ts";

export function estimate(
  isCkb2Udt: boolean,
  amounts: ValueComponents,
  system: SystemState,
  options?: { fee?: ccc.Num; feeBase?: ccc.Num },
): ConversionOrderEstimate {
  const estimateOptions = { fee: 1n, feeBase: 100000n, ...options };
  const conversion = estimateConversionOrder(
    isCkb2Udt,
    amounts,
    system,
    estimateOptions.fee,
    estimateOptions.feeBase,
  );
  if (conversion === undefined) {
    throw new OrderConversionRepresentabilityError();
  }

  return conversion;
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

export {
  estimateConversionOrder,
  estimateMaturityFeeThreshold,
} from "./sdk_estimate_core.ts";
export { maxMaturity };

function estimateIckbToCkbOrderDefaultFee(
  amounts: ValueComponents,
  system: SystemState,
): ConversionOrderEstimate | undefined {
  return estimateConversionOrder(false, amounts, system, 1n, 100000n);
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
  const baseEstimate = estimateConversionOrder(false, amounts, system, 0n, 100000n);
  if (baseEstimate === undefined) {
    return undefined;
  }
  const targetFee = estimateMaturityFeeThreshold(system);
  const feeBase = baseEstimate.convertedAmount + 1n;
  if (targetFee <= 0n || feeBase <= 1n) {
    return baseEstimate;
  }
  const estimateWithFee = (fee: bigint): ConversionOrderEstimate | undefined =>
    estimateConversionOrder(false, amounts, system, fee, feeBase);
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
