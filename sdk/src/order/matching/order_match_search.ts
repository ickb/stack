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
  /** CKB and iCKB this order and the rest could hand the bot, ignoring fees. */
  receivableCkb: bigint;
  receivableUdt: bigint;
  /** Gain this order and the rest could still add, ignoring what funds them. */
  positiveGain: bigint;
}

/** The fills chosen so far, mutated along the depth-first walk and restored on return. */
interface State {
  ckbDelta: bigint;
  udtDelta: bigint;
  partials: Match["partials"];
  used: Set<string>;
}

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
  /** A pass refused a skip because its discrepancy allowance was spent. */
  public limitHit = false;
  public readonly context: BestMatchContext;
  /** The gaining orders of each direction, best margin first, for the closers. */
  public readonly buyers: Node[] = [];
  public readonly sellers: Node[] = [];
  /** What the two closers could add at most, on top of the orders still undecided. */
  public closerUpper = 0n;
  private buyerGain = 0n;
  private sellerGain = 0n;

  constructor(context: BestMatchContext) {
    this.context = context;
  }

  /** Charges one node; false once the budget is spent, recording the bound left behind. */
  public charge(upper: bigint): boolean {
    if (this.exhausted) {
      this.unvisitedUpper = maxBigInt(this.unvisitedUpper, upper);
      return false;
    }
    if (this.work === this.context.candidateBudget) {
      this.exhausted = true;
      this.unvisitedUpper = upper;
      return false;
    }
    this.work += 1;
    return true;
  }

  /** Runs the passes: no skips, one, two, then any number, until one is exhaustive. */
  public run(root: Node | undefined): void {
    for (const skips of [0, 1, 2, Infinity]) {
      this.startPass();
      visit(
        this,
        root,
        { ckbDelta: 0n, udtDelta: 0n, partials: [], used: new Set() },
        skips,
      );
      if (!this.limitHit || this.exhausted) {
        return;
      }
    }
  }

  public startPass(): void {
    this.limitHit = false;
  }

  public refuseSkip(): void {
    this.limitHit = true;
  }

  /** Records a gaining order as a closer candidate and widens the closer bound. */
  public addCloser(node: Node, gain: bigint): void {
    if (node.matcher.isCkb2Udt) {
      this.buyers.unshift(node);
      this.buyerGain = maxBigInt(this.buyerGain, gain);
    } else {
      this.sellers.unshift(node);
      this.sellerGain = maxBigInt(this.sellerGain, gain);
    }
    this.closerUpper = this.buyerGain + this.sellerGain;
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
 * Depth-first search over the orders, best margin first: each order is taken whole or
 * skipped, and only the final net balances of the whole selection must fit the allowance,
 * so what buyers pay funds sellers in the same transaction and vice versa, even from empty
 * inventory. At every node the balances are closed by at most one partial fill per
 * direction from the orders not yet decided (a two-constraint optimum has at most two
 * fractional orders), one of them funded by the other's proceeds; a closer may also
 * repair a selection the whole fills alone leave short. Passes allow zero, one, two, and
 * then any number of skips of takeable orders, so a small order taken first cannot keep
 * the walk in its own subtree while the budget runs out. A branch is pruned when even the
 * whole remaining supply cannot make it feasible, or when its gain plus every remaining
 * gain cannot beat the incumbent. The node budget ends the search with the best feasible
 * match seen and the largest gain an unvisited branch could still hold (decisions
 * amendment 52).
 */
export function searchBestMatch(context: BestMatchContext): MatchSearchResult {
  const search = new Search(context);
  const root = bookNodes(search);
  if (context.maxPartials !== 0) {
    search.run(root);
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
    const gain = gainOf(context, full) + slack;
    const node: Node = {
      matcher,
      full,
      key: matcher.group.order.cell.outPoint.toHex(),
      next,
      receivableCkb: (next?.receivableCkb ?? 0n) + maxBigInt(full.ckbDelta, 0n),
      receivableUdt: (next?.receivableUdt ?? 0n) + maxBigInt(full.udtDelta, 0n),
      positiveGain: (next?.positiveGain ?? 0n) + maxBigInt(gain, 0n),
    };
    if (gain > 0n) {
      search.addCloser(node, gain);
    }
    next = node;
  }
  return next;
}

function visit(
  search: Search,
  node: Node | undefined,
  state: State,
  skips: number,
): void {
  const { context } = search;
  const upper =
    stateGain(context, state) + (node?.positiveGain ?? 0n) + search.closerUpper;
  if (!search.charge(upper)) {
    return;
  }
  const ckbLeft =
    context.allowance.ckbValue +
    state.ckbDelta -
    context.ckbMiningFee * BigInt(state.partials.length);
  const udtLeft = context.allowance.udtValue + state.udtDelta;
  search.record(closed(search, state, ckbLeft, udtLeft));
  if (
    node === undefined ||
    upper <= search.best.gain ||
    ckbLeft + node.receivableCkb < 0n ||
    udtLeft + node.receivableUdt < 0n
  ) {
    return;
  }
  const takeable = !state.used.has(node.key) && hasSlot(context, state, 1);
  if (takeable) {
    state.used.add(node.key);
    state.partials.push(...node.full.partials);
    visit(
      search,
      node.next,
      {
        ...state,
        ckbDelta: state.ckbDelta + node.full.ckbDelta,
        udtDelta: state.udtDelta + node.full.udtDelta,
      },
      skips,
    );
    state.partials.pop();
    state.used.delete(node.key);
    if (skips === 0) {
      search.refuseSkip();
      return;
    }
  }
  visit(search, node.next, state, takeable ? skips - 1 : skips);
}

/**
 * The state plus the best closing partials: the best unused buyer and seller, alone or
 * one funding the other, whichever gains most among the feasible ones; the state alone
 * when it is feasible and nothing improves it. Each candidate is paid from the leftover
 * balances plus what the earlier fill hands over. An order skipped whole earlier stays
 * available as a closer, since skipping the whole fill never rules out a partial one.
 */
function closed(
  search: Search,
  state: State,
  ckbLeft: bigint,
  udtLeft: bigint,
): Match | undefined {
  const { context } = search;
  const fee = context.ckbMiningFee;
  const buyer = search.buyers.find((node) => !state.used.has(node.key))?.matcher;
  const seller = search.sellers.find((node) => !state.used.has(node.key))?.matcher;
  const buy = (udt: bigint): Match[] =>
    buyer === undefined ? [] : fillsOf([buyer.match(cap(buyer, udt))]);
  const sell = (ckb: bigint): Match[] =>
    seller === undefined ? [] : fillsOf([seller.match(cap(seller, ckb))]);
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
  const bought = buy(udtLeft);
  const sold = sell(ckbLeft - fee);
  consider([]);
  consider(bought);
  consider(sold);
  for (const fill of bought) {
    consider([fill, ...sell(ckbLeft - 2n * fee + fill.ckbDelta)]);
  }
  for (const fill of sold) {
    consider([fill, ...buy(udtLeft + fill.udtDelta)]);
  }
  return best;
}

/** The payment a budget allows: nothing below the minimum, the whole order at most. */
function cap(matcher: OrderMatcher, budget: bigint): bigint {
  return budget < matcher.bMaxMatch ? budget : matcher.bMaxMatch;
}

function fillsOf(fills: Match[]): Match[] {
  return fills.filter((fill) => fill.partials.length > 0);
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
