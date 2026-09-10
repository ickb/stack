import { ccc } from "@ckb-ccc/core";
import {
  compareBigInt,
  type ExchangeRatio,
  type ValueComponents,
} from "../../utils/index.ts";
import type { OrderGroup } from "../model/cells.ts";
import type {
  Match,
  MatchDiagnostics,
  MatchDirectionDiagnostics,
} from "./match_types.ts";
import { OrderMatcher } from "./order_matcher.ts";

const CELL_INPUT_SERIALIZED_SIZE = 44;
// CellOutput table/script wrappers plus DynVec offset; output data Bytes plus offset.
const CELL_OUTPUT_SERIALIZATION_OVERHEAD = 60;
const OUTPUT_DATA_SERIALIZATION_OVERHEAD = 8;
// The supported SDK completion prepares a later signer witness, inserting one
// empty witness-vector entry for each preceding order input.
const EMPTY_WITNESS_SERIALIZATION_SIZE = 8;
const PREPARED_PARTIAL_SERIALIZATION_OVERHEAD =
  CELL_INPUT_SERIALIZED_SIZE +
  CELL_OUTPUT_SERIALIZATION_OVERHEAD +
  OUTPUT_DATA_SERIALIZATION_OVERHEAD +
  EMPTY_WITNESS_SERIALIZATION_SIZE;
const DEFAULT_CANDIDATE_BUDGET = 100_000;
// Beyond this many fundable orders per direction the smallest gains wait for the next
// turn: whoever floods the book pays cell capacity for every order and only moves the
// bot onto the larger ones, and the walk's recursion depth stays bounded. Capping each
// direction on its own keeps the funding side of a lopsided book in the search.
const MAX_SEARCH_ORDERS_PER_DIRECTION = 500;

/** Options controlling bounded best-match search. @public */
export interface BestMatchOptions {
  /** Fee rate in shannons per 1,000 prepared transaction bytes. */
  feeRate?: ccc.Num;
  /** Maximum number of partial order outputs. */
  maxPartials?: number;
  /** Maximum search nodes before returning incomplete. */
  candidateBudget?: number;
}

export interface BestMatchContext {
  allowance: ValueComponents;
  candidateBudget: number;
  ckbMiningFee: ccc.FixedPoint;
  ckbScale: bigint;
  udtScale: bigint;
  /** Both directions, best margin first; a cell in both directions appears twice. */
  matchers: OrderMatcher[];
  /** What a unit of each asset costs to obtain from the book, times `PRICE_SCALE`. */
  prices: { udt: bigint; ckb: bigint };
  diagnostics: MatchDiagnostics;
  maxPartials?: number;
}

/** Fixed-point scale of the asset prices. */
export const PRICE_SCALE = 1n << 32n;

export function createBestMatchContext({
  orderPool,
  allowance,
  exchangeRate,
  orderSize,
  options,
}: {
  orderPool: OrderGroup[];
  allowance: ValueComponents;
  exchangeRate: ExchangeRatio;
  orderSize: number;
  options: BestMatchOptions | undefined;
}): BestMatchContext {
  const { ckbScale, udtScale } = checkedExchangeRate(exchangeRate);
  const candidateBudget = checkedCandidateBudget(options?.candidateBudget);
  const feeRate = checkedFeeRate(options?.feeRate);
  const maxPartials = checkedMaxPartials(options?.maxPartials);
  const ckbMiningFee =
    (preparedPartialOrderSerializedSize(orderSize) * feeRate + 999n) / 1000n;
  // A pool that repeats a cell would let the walk fill it twice; one entry per outpoint.
  const uniquePool = [
    ...new Map(
      orderPool.map((group) => [group.order.cell.outPoint.toHex(), group]),
    ).values(),
  ];
  const ckbToUdtMatchers = orderMatchers(uniquePool, true, ckbMiningFee);
  const udtToCkbMatchers = orderMatchers(uniquePool, false, ckbMiningFee);
  const context: BestMatchContext = {
    allowance,
    candidateBudget,
    ckbMiningFee,
    ckbScale,
    udtScale,
    matchers: [],
    prices: { udt: 0n, ckb: 0n },
    ...(maxPartials === undefined ? {} : { maxPartials }),
    diagnostics: {
      orderCount: orderPool.length,
      allowance,
      candidateBudget,
      workCount: 0,
      ckbMiningFee,
      ...(maxPartials === undefined ? {} : { maxPartials }),
      directions: {
        ckbToUdt: summarizeMatchers(ckbToUdtMatchers),
        udtToCkb: summarizeMatchers(udtToCkbMatchers),
      },
      bestGain: 0n,
      gainUpperBound: 0n,
      truncatedMatchers: 0,
    },
  };
  const fundable = fundableMatchers(context, ckbToUdtMatchers, udtToCkbMatchers);
  const byGain = (matchers: OrderMatcher[]): OrderMatcher[] =>
    matchers
      .toSorted((left, right) =>
        compareBigInt(fullGain(context, right), fullGain(context, left)),
      )
      .slice(0, MAX_SEARCH_ORDERS_PER_DIRECTION);
  const buyers = byGain(fundable.buyers);
  const sellers = byGain(fundable.sellers);
  context.diagnostics.truncatedMatchers =
    ckbToUdtMatchers.length + udtToCkbMatchers.length - buyers.length - sellers.length;
  context.matchers = interleaved(buyers, sellers);
  context.prices = assetPrices(context);
  return context;
}

/**
 * Prices the two assets as Lagrange multipliers on the balance constraints: for any
 * non-negative pair, a selection's gain is at most its gain plus the priced balances
 * plus every order's gain net of what it takes at those prices, so a book whose losing
 * sellers are the only source of iCKB bounds each buyer by its gain net of that cost.
 * Each price is the minimiser of the root bound, one asset after the other.
 */
function assetPrices(context: BestMatchContext): { udt: bigint; ckb: bigint } {
  const fee = context.ckbMiningFee;
  const orders = context.matchers.map((matcher) => {
    const full = fullFill(matcher);
    return {
      gain: gainOf(context, full) * PRICE_SCALE,
      udt: full.udtDelta,
      ckb: full.ckbDelta - fee,
    };
  });
  const udt = price(
    context.allowance.udtValue,
    orders.map((order) => ({ value: order.gain, amount: order.udt })),
  );
  const ckb = price(
    context.allowance.ckbValue,
    orders.map((order) => ({ value: order.gain + udt * order.udt, amount: order.ckb })),
  );
  return { udt, ckb };
}

/**
 * The non-negative price minimising the held amount times the price plus every order's
 * value net of its amount at that price, floored at zero, which is convex and piecewise linear: its slope starts as the held amount
 * plus every gaining order's amount and rises by an order's absolute amount where that
 * order's term turns on or off, so the minimum is the first such point with a
 * non-negative slope.
 */
function price(held: bigint, orders: Array<{ value: bigint; amount: bigint }>): bigint {
  let slope = held;
  const turns: Array<{ at: bigint; rise: bigint }> = [];
  for (const { value, amount } of orders) {
    if (value > 0n) {
      slope += amount;
    }
    if ((amount > 0n && value <= 0n) || (amount < 0n && value > 0n)) {
      turns.push({ at: -value / amount, rise: amount < 0n ? -amount : amount });
    }
  }
  for (const turn of turns.toSorted((left, right) => compareBigInt(left.at, right.at))) {
    if (slope >= 0n) {
      break;
    }
    slope += turn.rise;
    if (slope >= 0n) {
      return turn.at;
    }
  }
  return 0n;
}

/** Value of a match at the exchange ratio, net of one fee per partial. */
export function gainOf(context: BestMatchContext, match: Match): bigint {
  return (
    (match.ckbDelta - context.ckbMiningFee * BigInt(match.partials.length)) *
      context.ckbScale +
    match.udtDelta * context.udtScale
  );
}

/**
 * One unit of rounding in the bot's favour, valued at the exchange ratio: a partial fill
 * can gain this much more than the full fill's per-unit rate, so bounds add it per order.
 */
export function gainSlack(context: BestMatchContext): bigint {
  return context.ckbScale + context.udtScale;
}

/** The full fill of a matcher: everything the order offers. */
export function fullFill(matcher: OrderMatcher): Match {
  return matcher.create(matcher.aMin, matcher.bMaxOut);
}

/** Gain of the whole order at the exchange ratio, net of its fee. */
export function fullGain(context: BestMatchContext, matcher: OrderMatcher): bigint {
  return gainOf(context, fullFill(matcher));
}

/**
 * Drops the orders no combination could pay: a buyer's minimum beyond the iCKB
 * allowance plus everything every payable seller could hand over, and the same for
 * sellers. Each direction is sorted by its minimum, so dropping the largest minimum
 * first and taking its supply from the other direction's budget settles both in one
 * sweep, however long the chain of orders that only paid for each other.
 */
function fundableMatchers(
  context: BestMatchContext,
  buyers: OrderMatcher[],
  sellers: OrderMatcher[],
): { buyers: OrderMatcher[]; sellers: OrderMatcher[] } {
  const byMinimum = (matchers: OrderMatcher[]): OrderMatcher[] =>
    matchers.toSorted((left, right) => compareBigInt(left.bMinMatch, right.bMinMatch));
  const supply = (matcher: OrderMatcher): bigint => {
    const full = fullFill(matcher);
    return matcher.isCkb2Udt ? full.ckbDelta : full.udtDelta;
  };
  const sorted = { buyers: byMinimum(buyers), sellers: byMinimum(sellers) };
  const budget = {
    buyers:
      context.allowance.udtValue + sorted.sellers.reduce((sum, m) => sum + supply(m), 0n),
    sellers:
      context.allowance.ckbValue -
      context.ckbMiningFee +
      sorted.buyers.reduce((sum, m) => sum + supply(m), 0n),
  };
  for (let dropped = true; dropped;) {
    dropped = false;
    for (const [side, other] of [
      ["buyers", "sellers"],
      ["sellers", "buyers"],
    ] as const) {
      for (
        let last = sorted[side].at(-1);
        last !== undefined && last.bMinMatch > budget[side];
        last = sorted[side].at(-1)
      ) {
        sorted[side].pop();
        budget[other] -= supply(last);
        dropped = true;
      }
    }
  }
  return sorted;
}

/**
 * Alternates buyers and sellers, best gain first, so the walk's first descent takes
 * self-funding pairs and the small orders sit at the leaves where a skip is cheap.
 */
function interleaved(buyers: OrderMatcher[], sellers: OrderMatcher[]): OrderMatcher[] {
  const matchers: OrderMatcher[] = [];
  for (let index = 0; index < Math.max(buyers.length, sellers.length); index += 1) {
    matchers.push(...buyers.slice(index, index + 1), ...sellers.slice(index, index + 1));
  }
  return matchers;
}

export function orderMatchers(
  orderPool: OrderGroup[],
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcher[] {
  return orderPool
    .map((group) => OrderMatcher.from(group, isCkb2Udt, ckbMiningFee))
    .filter((matcher): matcher is OrderMatcher => matcher !== undefined);
}

function summarizeMatchers(matchers: OrderMatcher[]): MatchDirectionDiagnostics {
  let minAllowance: ccc.FixedPoint | undefined;
  let maxMatch: ccc.FixedPoint | undefined;
  for (const matcher of matchers) {
    minAllowance =
      minAllowance === undefined || matcher.bMinMatch < minAllowance
        ? matcher.bMinMatch
        : minAllowance;
    maxMatch =
      maxMatch === undefined || matcher.bMaxMatch > maxMatch
        ? matcher.bMaxMatch
        : maxMatch;
  }
  return {
    matchableCount: matchers.length,
    ...(minAllowance === undefined ? {} : { minAllowance }),
    ...(maxMatch === undefined ? {} : { maxMatch }),
  };
}

function checkedFeeRate(feeRate: ccc.Num = 1000n): ccc.Num {
  if (feeRate < 0n) {
    throw new Error("Fee rate must be non-negative");
  }
  return feeRate;
}

function checkedCandidateBudget(
  candidateBudget: number = DEFAULT_CANDIDATE_BUDGET,
): number {
  if (!Number.isSafeInteger(candidateBudget) || candidateBudget <= 0) {
    throw new Error("Candidate budget must be a positive safe integer");
  }
  return candidateBudget;
}

function checkedMaxPartials(maxPartials?: number): number | undefined {
  if (
    maxPartials !== undefined &&
    (!Number.isSafeInteger(maxPartials) || maxPartials < 0)
  ) {
    throw new Error("Maximum partials must be a non-negative safe integer");
  }
  return maxPartials;
}

export function preparedPartialOrderSerializedSize(orderOccupiedSize: number): bigint {
  return ccc.numFrom(orderOccupiedSize + PREPARED_PARTIAL_SERIALIZATION_OVERHEAD);
}

function checkedExchangeRate(exchangeRate: ExchangeRatio): {
  ckbScale: bigint;
  udtScale: bigint;
} {
  const { ckbScale, udtScale } = exchangeRate;
  if (ckbScale <= 0n || udtScale <= 0n) {
    throw new Error("Exchange rate scales must be positive");
  }
  return { ckbScale, udtScale };
}
