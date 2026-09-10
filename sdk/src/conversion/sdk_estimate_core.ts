import { OrderConversionRepresentabilityError, quoteConversion } from "../order/index.ts";
import type { ValueComponents } from "../utils/index.ts";
import { maturity } from "./sdk_maturity.ts";
import type { ConversionOrderEstimate, SystemState } from "./sdk_types.ts";

export function estimateConversionOrder(
  isCkb2Udt: boolean,
  amounts: ValueComponents,
  system: SystemState,
  { fee, feeBase }: { fee: bigint; feeBase: bigint },
): ConversionOrderEstimate | undefined {
  let quote: ReturnType<typeof quoteConversion>;
  try {
    quote = quoteConversion(isCkb2Udt, system.exchangeRatio, amounts, {
      fee,
      feeBase,
    });
  } catch (error) {
    if (error instanceof OrderConversionRepresentabilityError) {
      return undefined;
    }
    throw error;
  }
  const estimatedMaturity =
    quote.ckbFee >= estimateMaturityFeeThreshold(system)
      ? maturity({ info: quote.info, amounts }, system)
      : undefined;
  return { ...quote, maturity: estimatedMaturity };
}

/**
 * Returns the CKB fee threshold above which order maturity is worth estimating.
 *
 * @public
 */
export function estimateMaturityFeeThreshold(
  system: Pick<SystemState, "feeRate">,
): bigint {
  return 10n * system.feeRate;
}
