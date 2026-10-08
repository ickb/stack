import type { ccc } from "@ckb-ccc/core";
import type { ExchangeRatio } from "../utils/utils.ts";
import type { OrderGroup } from "./cells.ts";
import { partialOrderFee } from "./fee.ts";
import { type Match, OrderMatcher } from "./matcher.ts";

/**
 * What a fill must return before the bot takes it, in mining fees of its own: the buffer
 * for the deposits and withdrawals that rebalance the inventory it moves (user decision
 * 2026-09-10, tuned on testnet). One rule for the bot's fills and the refused-buy
 * classification used by the generator and interface.
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
 * Whether a buy fails today's whole-fill profitability rule and should be collected.
 * DAO growth makes it less attractive, though a lower fee rate could change this result.
 * Sells are not refused: growth can make them profitable later, so unfilled sells return
 * only through the age cutoff ({@link isStale}).
 */
export function isRefused(
  group: OrderGroup,
  { exchangeRatio, feeRate }: { exchangeRatio: ExchangeRatio; feeRate: ccc.Num },
): boolean {
  return (
    group.order.data.info.isCkb2Udt() && !fillsWhole(group, true, exchangeRatio, feeRate)
  );
}

/** Thirty days of eight-second blocks. */
export const STALE_ORDER_BLOCKS = (30n * 24n * 60n * 60n) / 8n;

/**
 * Whether the order has sat on the book for thirty days: whatever the reason (dust under
 * the fill's cost, a remainder another matcher left, an ask above the market), it is
 * collected and its funds returned. Age from the origin's block, so an uncommitted origin
 * is as fresh as an order gets. The block count assumes eight-second blocks, not wall time.
 */
export function isStale(group: OrderGroup, tip: ccc.ClientBlockHeader): boolean {
  return (group.blockNumber ?? tip.number) + STALE_ORDER_BLOCKS <= tip.number;
}
