import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  OrderConversionRepresentabilityError,
  quoteConversion,
  type Ratio,
} from "@ickb/sdk";

/**
 * The output of converting `amount` at the default order fee, in shannons, without building
 * a transaction; undefined when no order can represent the amount.
 */
export function conversionQuote(
  isCkb2Udt: boolean,
  amount: bigint,
  exchangeRatio: Ratio,
): bigint | undefined {
  try {
    return quoteConversion(
      isCkb2Udt,
      exchangeRatio,
      { ckbValue: isCkb2Udt ? amount : 0n, udtValue: isCkb2Udt ? 0n : amount },
      { fee: DEFAULT_ORDER_FEE, feeBase: DEFAULT_ORDER_FEE_BASE },
    ).convertedAmount;
  } catch (error) {
    if (error instanceof OrderConversionRepresentabilityError) {
      return undefined;
    }
    throw error;
  }
}
