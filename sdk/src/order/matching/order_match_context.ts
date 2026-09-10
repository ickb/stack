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
  diagnostics: MatchDiagnostics;
  maxPartials?: number;
}

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
  return context;
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
 * sellers, until no order's supply rests on one that was dropped.
 */
function fundableMatchers(
  context: BestMatchContext,
  buyers: OrderMatcher[],
  sellers: OrderMatcher[],
): { buyers: OrderMatcher[]; sellers: OrderMatcher[] } {
  const supply = (matchers: OrderMatcher[], isCkb: boolean): bigint =>
    matchers.reduce((sum, matcher) => {
      const full = fullFill(matcher);
      return sum + (isCkb ? full.ckbDelta : full.udtDelta);
    }, 0n);
  const udtBudget = context.allowance.udtValue + supply(sellers, false);
  const ckbBudget =
    context.allowance.ckbValue - context.ckbMiningFee + supply(buyers, true);
  const fundable = {
    buyers: buyers.filter((matcher) => matcher.bMinMatch <= udtBudget),
    sellers: sellers.filter((matcher) => matcher.bMinMatch <= ckbBudget),
  };
  return fundable.buyers.length === buyers.length &&
    fundable.sellers.length === sellers.length
    ? fundable
    : fundableMatchers(context, fundable.buyers, fundable.sellers);
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
