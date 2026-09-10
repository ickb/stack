import { compareBigInt } from "../../utils/index.ts";
import type { Match, MatchSearchResult } from "./match_types.ts";
import {
  type BestMatchContext,
  fullFill,
  gainOf,
  gainSlack,
} from "./order_match_context.ts";
import type { OrderMatcher } from "./order_matcher.ts";

/** One order of the sorted book with what the book from it on could still add. */
interface Node {
  matcher: OrderMatcher;
  full: Match;
  key: string;
  /** Gain of the whole fill, net of its fee; negative for a losing order. */
  gain: bigint;
  /** The whole gain as a number, for ranking closers cheaply. */
  gainNumber: number;
  /** Gain per unit of the asset the bot pays, for what a smaller fill is worth. */
  rate: number;
  next: Node | undefined;
  /** Gain this order and the rest could still add, ignoring what funds them. */
  positiveGain: bigint;
}

/** The fills chosen so far, mutated along the depth-first walk and restored on return. */
interface State {
  ckbDelta: bigint;
  udtDelta: bigint;
  partials: Match["partials"];
  used: Set<string>;
  /**
   * The balances if every unused order were also taken whole: negative means no fill
   * of the rest could repay what the taken orders spent.
   */
  reachableCkb: bigint;
  reachableUdt: bigint;
}

interface Fill {
  key: string;
  fill: Match;
}

/** How many unused orders of a direction a node probes as closers, per fill size. */
const CLOSERS = 2;

/** Search progress; the walk mutates it through its own methods. */
class Search {
  public best: { match: Match; gain: bigint } = {
    match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    gain: 0n,
  };
  public work = 0;
  /** Once the budget is spent, every unvisited subtree only records its bound. */
  public exhausted = false;
  public unvisitedUpper = 0n;
  public readonly context: BestMatchContext;
  /** Every order of each direction, largest whole gain first, for the closers. */
  public readonly buyers: Node[] = [];
  public readonly sellers: Node[] = [];
  /** What the two closers could add at most, on top of the orders still undecided. */
  public closerUpper = 0n;
  /** CKB and iCKB the whole book could hand the bot. */
  public receivableCkb = 0n;
  public receivableUdt = 0n;

  constructor(context: BestMatchContext) {
    this.context = context;
  }

  /** Charges one unit of work; false once the budget is spent, recording the bound left behind. */
  public charge(upper: bigint): boolean {
    if (this.exhausted) {
      this.unvisitedUpper = maxBigInt(this.unvisitedUpper, upper);
      return false;
    }
    if (this.work >= this.context.candidateBudget) {
      this.exhausted = true;
      this.unvisitedUpper = upper;
      return false;
    }
    this.work += 1;
    return true;
  }

  /** Links the sorted book from the last order back to the first, accumulating the bounds. */
  public link(): Node | undefined {
    const { context } = this;
    const slack = gainSlack(context);
    let next: Node | undefined;
    let buyerUpper = 0n;
    let sellerUpper = 0n;
    for (const matcher of context.matchers.toReversed()) {
      const full = fullFill(matcher);
      const gain = gainOf(context, full);
      const padded = maxBigInt(gain + slack, 0n);
      const node: Node = {
        matcher,
        full,
        key: matcher.group.order.cell.outPoint.toHex(),
        gain,
        gainNumber: Number(gain),
        rate: Number(gain) / Number(matcher.bMaxMatch),
        next,
        positiveGain: (next?.positiveGain ?? 0n) + padded,
      };
      if (matcher.isCkb2Udt) {
        this.buyers.unshift(node);
        buyerUpper = maxBigInt(buyerUpper, padded);
      } else {
        this.sellers.unshift(node);
        sellerUpper = maxBigInt(sellerUpper, padded);
      }
      this.receivableCkb += maxBigInt(full.ckbDelta, 0n);
      this.receivableUdt += maxBigInt(full.udtDelta, 0n);
      next = node;
    }
    this.closerUpper = buyerUpper + sellerUpper;
    return next;
  }

  public record(candidate: Match | undefined): void {
    if (candidate === undefined) {
      return;
    }
    const gain = gainOf(this.context, candidate);
    if (gain > this.best.gain) {
      this.best = { match: candidate, gain };
    }
  }
}

/**
 * Depth-first search over the orders, largest gain first with the two directions
 * interleaved: each order is taken whole or skipped, and only the final net balances of
 * the whole selection must fit the allowance, so what buyers pay funds sellers in the
 * same transaction and vice versa, even from empty inventory. An order is taken only
 * while the rest of the book could still repay it. At every node the balances are
 * closed by at most one partial fill per direction from the unused orders whose fill
 * is worth most at the size the balances pay, any gain, one of them funded by the
 * other's proceeds, sized to the largest fill the balances pay or the smallest that
 * repairs a deficit, so a partial can repair what whole fills leave short. A branch is
 * pruned when its gain plus every remaining gain cannot beat the incumbent. The work
 * budget, charged per node, per closer examined and per closer probed, ends the search
 * with the best feasible match seen and the largest gain an unvisited branch could
 * still hold (decisions amendment 52).
 */
export function searchBestMatch(context: BestMatchContext): MatchSearchResult {
  const search = new Search(context);
  const root = search.link();
  if (context.maxPartials !== 0) {
    visit(search, root, {
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      used: new Set(),
      reachableCkb: context.allowance.ckbValue + search.receivableCkb,
      reachableUdt: context.allowance.udtValue + search.receivableUdt,
    });
  }
  const diagnostics = context.diagnostics;
  diagnostics.workCount = search.work;
  diagnostics.bestGain = search.best.gain;
  const match = { ...search.best.match, diagnostics };
  if (!search.exhausted) {
    diagnostics.gainUpperBound = search.best.gain;
    return { kind: "complete", match };
  }
  const upper = maxBigInt(search.unvisitedUpper, search.best.gain);
  diagnostics.gainUpperBound = upper;
  return {
    kind: "incomplete",
    match,
    budget: context.candidateBudget,
    work: search.work,
    gap: upper - search.best.gain,
  };
}

function visit(search: Search, node: Node | undefined, state: State): void {
  const { context } = search;
  const upper =
    stateGain(context, state) + (node?.positiveGain ?? 0n) + search.closerUpper;
  if (!search.charge(upper)) {
    return;
  }
  search.record(closed(search, state, upper));
  if (node === undefined || upper <= search.best.gain) {
    return;
  }
  const reachableCkb =
    state.reachableCkb + minBigInt(node.full.ckbDelta, 0n) - context.ckbMiningFee;
  const reachableUdt = state.reachableUdt + minBigInt(node.full.udtDelta, 0n);
  if (
    !state.used.has(node.key) &&
    hasSlot(context, state, 1) &&
    reachableCkb >= 0n &&
    reachableUdt >= 0n
  ) {
    state.used.add(node.key);
    state.partials.push(...node.full.partials);
    visit(search, node.next, {
      ...state,
      ckbDelta: state.ckbDelta + node.full.ckbDelta,
      udtDelta: state.udtDelta + node.full.udtDelta,
      reachableCkb,
      reachableUdt,
    });
    state.partials.pop();
    state.used.delete(node.key);
  }
  visit(search, node.next, state);
}

/**
 * The state plus the best closing partials: unused buyers and sellers, alone or one
 * funding the other, whichever gains most among the feasible ones; the state alone when
 * it is feasible and nothing improves it. Each closer is paid from the leftover balances
 * plus what the earlier fill hands over, and is sized to the largest fill that budget
 * pays and to the smallest that repairs a deficit of the other asset. An order skipped
 * whole earlier stays available, since skipping the whole fill never rules out a partial.
 */
function closed(search: Search, state: State, upper: bigint): Match | undefined {
  const { context } = search;
  const fee = context.ckbMiningFee;
  const ckbLeft =
    context.allowance.ckbValue + state.ckbDelta - fee * BigInt(state.partials.length);
  const udtLeft = context.allowance.udtValue + state.udtDelta;
  let best: Match | undefined;
  let bestGain = 0n;
  const consider = (fills: Match[]): void => {
    if (!hasSlot(context, state, fills.length)) {
      return;
    }
    const candidate = withFills(state, fills);
    const gain = gainOf(context, candidate);
    if (
      (best === undefined || gain > bestGain) &&
      context.allowance.udtValue + candidate.udtDelta >= 0n &&
      context.allowance.ckbValue +
        candidate.ckbDelta -
        fee * BigInt(candidate.partials.length) >=
        0n
    ) {
      best = candidate;
      bestGain = gain;
    }
  };
  // The unused orders of one direction whose fill at the given size is worth most, from
  // the list sorted by whole gain, which bounds what any smaller fill is worth, so the
  // scan stops once no order left could beat the ones picked.
  const pick = (
    nodes: Node[],
    size: (matcher: OrderMatcher) => bigint | undefined,
    except: string | undefined,
  ): Array<{ node: Node; payment: bigint; worth: number }> => {
    const picked: Array<{ node: Node; payment: bigint; worth: number }> = [];
    for (const node of nodes) {
      const worst = picked[CLOSERS - 1];
      if (worst !== undefined && worst.worth >= 0 && node.gainNumber <= worst.worth) {
        break;
      }
      if (!search.charge(upper)) {
        break;
      }
      if (state.used.has(node.key) || node.key === except) {
        continue;
      }
      const payment = size(node.matcher);
      if (payment === undefined) {
        continue;
      }
      const worth = node.rate * Number(payment);
      const at = picked.findIndex((entry) => entry.worth < worth);
      picked.splice(at === -1 ? picked.length : at, 0, { node, payment, worth });
      picked.length = Math.min(picked.length, CLOSERS);
    }
    return picked;
  };
  // Fills of the best unused orders of one direction: the largest the budget pays, and
  // the smallest that repairs the given deficit of the asset the order hands back.
  const fills = (
    nodes: Node[],
    budget: bigint,
    deficit: bigint,
    except?: string,
  ): Fill[] => {
    const sizes = [
      (matcher: OrderMatcher): bigint | undefined =>
        matcher.bMinMatch <= budget ? minBigInt(budget, matcher.bMaxMatch) : undefined,
    ];
    if (deficit > 0n) {
      sizes.push((matcher: OrderMatcher): bigint | undefined => {
        const payment = maxBigInt(repairingPayment(matcher, deficit), matcher.bMinMatch);
        return payment <= minBigInt(budget, matcher.bMaxMatch) ? payment : undefined;
      });
    }
    const found: Fill[] = [];
    for (const { node, payment } of sizes.flatMap((size) => pick(nodes, size, except))) {
      if (!search.charge(upper)) {
        break;
      }
      const fill = node.matcher.match(payment);
      if (fill.partials.length > 0) {
        found.push({ key: node.key, fill });
      }
    }
    return found;
  };
  consider([]);
  const bought = fills(search.buyers, udtLeft, -(ckbLeft - fee));
  const sold = fills(search.sellers, ckbLeft - fee, -udtLeft);
  for (const { key, fill } of bought) {
    consider([fill]);
    const ckbAfter = ckbLeft - 2n * fee + fill.ckbDelta;
    for (const seller of fills(
      search.sellers,
      ckbAfter,
      -(udtLeft + fill.udtDelta),
      key,
    )) {
      consider([fill, seller.fill]);
    }
  }
  for (const { key, fill } of sold) {
    consider([fill]);
    const udtAfter = udtLeft + fill.udtDelta;
    for (const buyer of fills(
      search.buyers,
      udtAfter,
      -(ckbLeft - 2n * fee + fill.ckbDelta),
      key,
    )) {
      consider([fill, buyer.fill]);
    }
  }
  return best;
}

/** The payment that hands back at least `deficit` of the order's asset, one unit of rounding spare. */
function repairingPayment(matcher: OrderMatcher, deficit: bigint): bigint {
  return (deficit * matcher.aScale + matcher.bScale - 1n) / matcher.bScale + 1n;
}

function withFills(state: State, fills: Match[]): Match {
  const match = {
    ckbDelta: state.ckbDelta,
    udtDelta: state.udtDelta,
    partials: [...state.partials],
  };
  for (const fill of fills) {
    match.ckbDelta += fill.ckbDelta;
    match.udtDelta += fill.udtDelta;
    match.partials.push(...fill.partials);
  }
  return match;
}

function stateGain(context: BestMatchContext, state: State): bigint {
  return gainOf(context, {
    ckbDelta: state.ckbDelta,
    udtDelta: state.udtDelta,
    partials: state.partials,
  });
}

function hasSlot(context: BestMatchContext, state: State, needed: number): boolean {
  return (
    context.maxPartials === undefined ||
    state.partials.length + needed <= context.maxPartials
  );
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return compareBigInt(left, right) > 0 ? left : right;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return compareBigInt(left, right) < 0 ? left : right;
}
