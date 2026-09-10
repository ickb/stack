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
  next: Node | undefined;
  /** Gain this order and the rest could still add, ignoring what funds them. */
  positiveGain: bigint;
  /** CKB and iCKB this order and the rest could hand the bot with whole fills. */
  receivableCkb: bigint;
  receivableUdt: bigint;
}

/** The fills chosen so far, mutated along the depth-first walk and restored on return. */
interface State {
  ckbDelta: bigint;
  udtDelta: bigint;
  partials: Match["partials"];
  used: Set<string>;
}

// How many unused orders of a direction a node tries as closers, and how far down the
// direction's list it looks for ones the balances can pay.
const CLOSERS = 2;
const CLOSER_SCAN = 32;

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
  /** Every order of each direction, largest gain first, for the closers. */
  public readonly buyers: Node[] = [];
  public readonly sellers: Node[] = [];
  /** What the two closers could add at most, on top of the orders still undecided. */
  public closerUpper = 0n;
  private buyerUpper = 0n;
  private sellerUpper = 0n;

  constructor(context: BestMatchContext) {
    this.context = context;
  }

  /** Charges work; false once the budget is spent, recording the bound left behind. */
  public charge(upper: bigint, units = 1): boolean {
    if (this.exhausted) {
      this.unvisitedUpper = maxBigInt(this.unvisitedUpper, upper);
      return false;
    }
    if (this.work + units > this.context.candidateBudget) {
      this.exhausted = true;
      this.unvisitedUpper = upper;
      return false;
    }
    this.work += units;
    return true;
  }

  /** Registers an order as a closer candidate of its direction and widens the closer bound. */
  public addCloser(node: Node, gain: bigint): void {
    if (node.matcher.isCkb2Udt) {
      this.buyers.unshift(node);
      this.buyerUpper = maxBigInt(this.buyerUpper, gain);
    } else {
      this.sellers.unshift(node);
      this.sellerUpper = maxBigInt(this.sellerUpper, gain);
    }
    this.closerUpper = this.buyerUpper + this.sellerUpper;
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
 * same transaction and vice versa, even from empty inventory. Small orders sit at the
 * leaves, where skipping them costs little. At every node the balances are closed by at
 * most one partial fill per direction from the best unused orders, any gain, one of them
 * funded by the other's proceeds, sized to the largest fill the balances can pay or the
 * smallest that repairs a deficit, so a partial can repair what whole fills leave short.
 * A branch is pruned when its gain plus every remaining gain cannot beat the incumbent.
 * The work budget, charged per node and per closer probe, ends the search with the best
 * feasible match seen and the largest gain an unvisited branch could still hold
 * (decisions amendment 52).
 */
export function searchBestMatch(context: BestMatchContext): MatchSearchResult {
  const search = new Search(context);
  const root = bookNodes(search);
  if (context.maxPartials !== 0) {
    visit(search, root, { ckbDelta: 0n, udtDelta: 0n, partials: [], used: new Set() });
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

/** Links the sorted book from the last order back to the first, accumulating the bounds. */
function bookNodes(search: Search): Node | undefined {
  const { context } = search;
  const slack = gainSlack(context);
  let next: Node | undefined;
  for (const matcher of context.matchers.toReversed()) {
    const full = fullFill(matcher);
    const gain = maxBigInt(gainOf(context, full) + slack, 0n);
    const node: Node = {
      matcher,
      full,
      key: matcher.group.order.cell.outPoint.toHex(),
      next,
      positiveGain: (next?.positiveGain ?? 0n) + gain,
      receivableCkb: (next?.receivableCkb ?? 0n) + maxBigInt(full.ckbDelta, 0n),
      receivableUdt: (next?.receivableUdt ?? 0n) + maxBigInt(full.udtDelta, 0n),
    };
    search.addCloser(node, gain);
    next = node;
  }
  return next;
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
  const take = (): void => {
    if (state.used.has(node.key) || !hasSlot(context, state, 1)) {
      return;
    }
    state.used.add(node.key);
    state.partials.push(...node.full.partials);
    visit(search, node.next, {
      ...state,
      ckbDelta: state.ckbDelta + node.full.ckbDelta,
      udtDelta: state.udtDelta + node.full.udtDelta,
    });
    state.partials.pop();
    state.used.delete(node.key);
  };
  const skip = (): void => {
    visit(search, node.next, state);
  };
  // Take first when the rest of the book could still pay for the whole fill; otherwise
  // skip first, so an order too large for what remains does not hold the walk in its
  // subtree while the budget runs out. Order only: both children are still visited.
  const ckbAfter =
    context.allowance.ckbValue +
    state.ckbDelta +
    node.full.ckbDelta -
    context.ckbMiningFee * BigInt(state.partials.length + 1) +
    (node.next?.receivableCkb ?? 0n);
  const udtAfter =
    context.allowance.udtValue +
    state.udtDelta +
    node.full.udtDelta +
    (node.next?.receivableUdt ?? 0n);
  for (const child of ckbAfter >= 0n && udtAfter >= 0n ? [take, skip] : [skip, take]) {
    child();
  }
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
  let probes = 0;
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
  // Fills of the best unused orders of one direction: the largest the budget pays, and
  // the smallest that repairs the given deficit of the asset the order hands back.
  const fills = (
    nodes: Node[],
    budget: bigint,
    deficit: bigint,
    except?: string,
  ): Array<{ key: string; fill: Match }> => {
    const found: Array<{ key: string; fill: Match }> = [];
    for (const node of nodes.slice(0, CLOSER_SCAN)) {
      if (found.length >= 2 * CLOSERS) {
        break;
      }
      const { matcher, key } = node;
      if (state.used.has(key) || key === except || matcher.bMinMatch > budget) {
        continue;
      }
      const payments = [cap(matcher, budget)];
      if (deficit > 0n) {
        payments.push(cap(matcher, repairingPayment(matcher, deficit)));
      }
      for (const payment of new Set(payments)) {
        probes += 1;
        const fill = matcher.match(payment);
        if (fill.partials.length > 0) {
          found.push({ key, fill });
        }
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
  search.charge(upper, probes);
  return best;
}

/** The payment that hands back at least `deficit` of the order's asset, one unit of rounding spare. */
function repairingPayment(matcher: OrderMatcher, deficit: bigint): bigint {
  return (deficit * matcher.aScale + matcher.bScale - 1n) / matcher.bScale + 1n;
}

/** The payment a budget allows: nothing below the minimum, the whole order at most. */
function cap(matcher: OrderMatcher, budget: bigint): bigint {
  return budget < matcher.bMaxMatch ? budget : matcher.bMaxMatch;
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
