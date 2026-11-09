import type { ccc } from "@ckb-ccc/core";
import type { ExchangeRatio } from "../utils/utils.ts";
import type { OrderGroup } from "./cells.ts";
import { partialOrderFee } from "./fee.ts";
import { type Match, OrderMatcher } from "./matcher.ts";

/**
 * What a fill must return before the bot takes it, in mining fees of its own: the buffer
 * for the deposits and withdrawals that rebalance the inventory it moves (user decision
 * 2026-09-10, tuned on testnet). One rule for the bot's fills and the collect rule the
 * generator and interface share.
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
 * alone, independently of the bot's current inventory. Price and the sampled fee rate
 * decide profitability; balances decide whether a particular turn can afford it.
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

/**
 * Whether the owner's next transaction collects the order: the bot would take it whole in
 * neither direction at today's ratio and fee rate. That covers a fulfilled order, which has
 * nothing left to match, and a buy or a sell priced under the bot's fill cost; a fee spike
 * refuses a sell as it refuses a buy. No age cutoff backs it: one would refund only a
 * fillable order the bot has stopped filling, and the bot is watched.
 */
export function isCollectable(
  group: OrderGroup,
  { exchangeRatio, feeRate }: { exchangeRatio: ExchangeRatio; feeRate: ccc.Num },
): boolean {
  return (
    !fillsWhole(group, true, exchangeRatio, feeRate) &&
    !fillsWhole(group, false, exchangeRatio, feeRate)
  );
}
