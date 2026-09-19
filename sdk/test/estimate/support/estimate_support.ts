import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  estimateConversionOrder,
} from "../../../src/conversion/estimate.ts";
import type {
  ConversionOrderEstimate,
  SystemState,
} from "../../../src/conversion/types.ts";
import { OrderConversionRepresentabilityError } from "../../../src/order/conversion.ts";
export const ESTIMATE_SUITE = "IckbSdk.estimate";

/** The default-fee quote, as the planners take it; throws when no order ratio represents it. */
export function estimate(
  isCkb2Udt: boolean,
  amounts: { ckbValue: bigint; udtValue: bigint },
  state: SystemState,
  options: { fee?: bigint; feeBase?: bigint } = {},
): ConversionOrderEstimate {
  const result = estimateConversionOrder(isCkb2Udt, amounts, state, {
    fee: DEFAULT_ORDER_FEE,
    feeBase: DEFAULT_ORDER_FEE_BASE,
    ...options,
  });
  if (result === undefined) {
    throw new OrderConversionRepresentabilityError();
  }
  return result;
}
