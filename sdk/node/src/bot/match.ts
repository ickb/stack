import type { ccc } from "@ckb-ccc/core";
import type { Match, OrderGroup } from "../../../src/order/index.ts";
import { partialOrderFee } from "../../../src/order/io/order_io.ts";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import type { ExchangeRatio } from "../../../src/utils/index.ts";

import { FILL_COST_FEES } from "./policy/constants.ts";
import { MAX_MATCH_PARTIALS } from "./runtime/support.ts";

/** One turn's match and how it was chosen. */
export interface TurnMatch extends Match {
  /** Order directions the balances were offered to. */
  candidates: number;
  /** The shuffle seed, so the choice among equal fills can be replayed. */
  seed: number;
}

/**
 * The turn's match, one fill at a time: from the balances, take the fill that returns
 * most per unit of value paid, then again from the balances it leaves, until nothing
 * returns or the partial cap is reached. A fill is sized to the largest payment the
 * balances cover with the fee reserved, and returns its exchange value net of ten fees,
 * the buffer for the rebalancing it commits the bot to, so dust never ranks above
 * zero. Nothing is taken that the balances cannot pay: buyers and sellers fund each
 * other only across steps, whole orders beyond the balances wait for a later turn, and
 * losing orders are never bridges. Orders are shuffled once by the seed so equal fills
 * fall in no fixed order (decisions amendment 52).
 */
export function matchTurn({
  orders,
  ckb,
  udt,
  exchangeRatio,
  feeRate,
  seed,
  maxPartials = MAX_MATCH_PARTIALS,
}: {
  orders: OrderGroup[];
  ckb: bigint;
  udt: bigint;
  exchangeRatio: ExchangeRatio;
  feeRate: ccc.Num;
  seed: number;
  maxPartials?: number;
}): TurnMatch {
  const fee = partialOrderFee(orders, feeRate);
  const cost = FILL_COST_FEES * fee * exchangeRatio.ckbScale;
  const pool = [
    ...new Map(
      orders.map((group) => [group.order.cell.outPoint.toHex(), group]),
    ).values(),
  ];
  const matchers = shuffled(
    pool.flatMap((group) =>
      [true, false].flatMap(
        (isCkb2Udt) => OrderMatcher.from(group, isCkb2Udt, fee) ?? [],
      ),
    ),
    seed,
  );
  const match: TurnMatch = {
    ckbDelta: 0n,
    udtDelta: 0n,
    partials: [],
    candidates: matchers.length,
    seed,
  };
  const balances = { ckb, udt };
  while (match.partials.length < maxPartials) {
    const best = bestFill(matchers, balances, fee, cost, exchangeRatio);
    if (best === undefined) {
      break;
    }
    matchers.splice(best.index, 1);
    balances.ckb += best.fill.ckbDelta - fee;
    balances.udt += best.fill.udtDelta;
    match.ckbDelta += best.fill.ckbDelta;
    match.udtDelta += best.fill.udtDelta;
    match.partials.push(...best.fill.partials);
  }
  return match;
}

/** The fill that returns most per unit of value paid from the balances, if one returns its cost. */
function bestFill(
  matchers: OrderMatcher[],
  balances: { ckb: bigint; udt: bigint },
  fee: bigint,
  cost: bigint,
  { ckbScale, udtScale }: ExchangeRatio,
): { index: number; fill: Match } | undefined {
  let best: { index: number; fill: Match; net: bigint; paid: bigint } | undefined;
  for (const [index, matcher] of matchers.entries()) {
    // The fee is reserved before sizing, so a taken fill always leaves CKB for it.
    const allowance = matcher.isCkb2Udt ? balances.udt : balances.ckb - fee;
    if (balances.ckb < fee || allowance < matcher.bMinMatch) {
      continue;
    }
    const fill = matcher.match(minBigInt(allowance, matcher.bMaxMatch));
    const net = fill.ckbDelta * ckbScale + fill.udtDelta * udtScale - cost;
    const paid = matcher.isCkb2Udt
      ? -fill.udtDelta * udtScale
      : -fill.ckbDelta * ckbScale;
    if (net > 0n && (best === undefined || net * best.paid > best.net * paid)) {
      best = { index, fill, net, paid };
    }
  }
  return best;
}

/** The low bits of the tip hash: a seed that changes every block and is logged with the turn. */
export function seedOf(tipHash: ccc.Hex): number {
  return Number(BigInt(tipHash) & 0xff_ff_ff_ffn);
}

/** A uniform shuffle from a 32-bit seed (mulberry32), so a turn is replayable. */
function shuffled<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return items
    .map((item) => ({ item, key: next() }))
    .toSorted((left, right) => left.key - right.key)
    .map(({ item }) => item);
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
