import { OrderConversionRepresentabilityError, OrderManager } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import type { ConversionOrderEstimate, SystemState } from "../client/sdk_types.ts";
import { maturity } from "./sdk_maturity.ts";

export function estimateConversionOrder(
  ...[isCkb2Udt, amounts, system, fee, feeBase]: [
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    fee: bigint,
    feeBase: bigint,
  ]
): ConversionOrderEstimate | undefined {
  let quote: ReturnType<typeof OrderManager.convert>;
  try {
    quote = OrderManager.convert(isCkb2Udt, system.exchangeRatio, amounts, {
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
