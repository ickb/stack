import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  estimateConversionOrder,
} from "../../../src/conversion/estimate.ts";
import type {
  ConversionOrderEstimate,
  SystemState,
} from "../../../src/conversion/types.ts";
import type { OrderGroup } from "../../../src/order/cells.ts";
import { OrderConversionRepresentabilityError } from "../../../src/order/conversion.ts";
import { Info } from "../../../src/order/info.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import { projectionOrderGroup } from "../../conversion/planning/support/sdk_order_support.ts";

export const ESTIMATE_SUITE = "IckbSdk.estimate";

/** Half the DAO price, in CKB per iCKB, as an order ratio. */
export const HALF_PRICE = { ckbScale: 2n, udtScale: 1n };
/** Twice the DAO price, in CKB per iCKB, as an order ratio. */
export const DOUBLE_PRICE = { ckbScale: 1n, udtScale: 2n };

/**
 * A seller the bot would take whole (a cap's worth at half the DAO price, any minimum
 * match), committed at `blockNumber`; undefined means uncommitted, so fresh.
 */
export function sittingSeller(
  blockNumber: bigint | undefined,
  price: { ckbScale: bigint; udtScale: bigint } = HALF_PRICE,
  udtValue = 10n ** 13n,
): OrderGroup {
  const group = projectionOrderGroup({
    ckbValue: 0n,
    udtValue,
    isDualRatio: false,
    isMatchable: true,
    blockNumber,
  });
  group.order.data.info = Info.from({
    ckbToUdt: Ratio.empty(),
    udtToCkb: Ratio.from(price),
    ckbMinMatchLog: 0,
  });
  return group;
}

/** A buyer the bot would take whole: a cap's worth of CKB at twice the DAO price. */
export function fillableBuyer(
  ckbValue = 10n ** 13n,
  price: { ckbScale: bigint; udtScale: bigint } = DOUBLE_PRICE,
): OrderGroup {
  const group = projectionOrderGroup({
    ckbValue,
    udtValue: 0n,
    isDualRatio: false,
    isMatchable: true,
  });
  group.order.data.info = Info.from({
    ckbToUdt: Ratio.from(price),
    udtToCkb: Ratio.empty(),
    ckbMinMatchLog: 0,
  });
  return group;
}

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
