import type { ccc } from "@ckb-ccc/core";
import type { Match, OrderGroup } from "../../../src/order/index.ts";
import { partialOrderFee } from "../../../src/order/io/order_io.ts";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import type { ExchangeRatio } from "../../../src/utils/index.ts";

/**
 * What a fill must return before the bot takes it, in mining fees of its own: the buffer
 * for the deposits and withdrawals that rebalance the inventory it moves (user decision
 * 2026-09-10, tuned on testnet). Shared so the generator melts by the bot's own rule.
 */
const FILL_COST_FEES = 10n;

/** The cost of taking one fill, in the exchange value's unit. */
export function fillCost(fee: bigint, { ckbScale }: ExchangeRatio): bigint {
  return FILL_COST_FEES * fee * ckbScale;
}

/** A fill's exchange value at the DAO ratio, net of the cost of taking it. */
export function netOf(
  fill: Match,
  cost: bigint,
  { ckbScale, udtScale }: ExchangeRatio,
): bigint {
  return fill.ckbDelta * ckbScale + fill.udtDelta * udtScale - cost;
}

/** Whether the matcher's whole fill returns its cost. */
export function returnsCost(
  matcher: OrderMatcher,
  cost: bigint,
  exchangeRatio: ExchangeRatio,
): boolean {
  return netOf(matcher.match(matcher.bMaxMatch), cost, exchangeRatio) > 0n;
}

/**
 * Whether the bot would take the whole order in the given direction. Judged on the order
 * alone, since the balances change every turn but the price does not, so a generator can
 * tell an order the bot will never take from one it cannot yet afford.
 */
export function fillsWhole(
  group: OrderGroup,
  isCkb2Udt: boolean,
  exchangeRatio: ExchangeRatio,
  feeRate: ccc.Num,
): boolean {
  const fee = partialOrderFee([group], feeRate);
  const matcher = OrderMatcher.from(group, isCkb2Udt, fee);
  return (
    matcher !== undefined &&
    returnsCost(matcher, fillCost(fee, exchangeRatio), exchangeRatio)
  );
}
