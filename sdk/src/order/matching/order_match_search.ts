import { compareBigInt } from "../../utils/index.ts";
import type { Match, MatchSearchResult } from "./match_types.ts";
import {
  type BestMatchContext,
  fullFill,
  gainOf,
  PRICE_SCALE,
} from "./order_match_context.ts";
import type { OrderMatcher } from "./order_matcher.ts";

/** One order of the book with its whole fill and what that fill is worth. */
interface Entry {
  matcher: OrderMatcher;
  full: Match;
  key: string;
  /** Gain of the whole fill, net of its fee; negative for a losing order. */
  gain: bigint;
  /** The whole gain net of what the fill takes at the asset prices, times `PRICE_SCALE`. */
  priced: bigint;
  /** The gains padded by what a partial can gain over the whole fill's rate, floored at zero. */
  padded: bigint;
  paddedPriced: bigint;
}

/** One order of a walk's chain with what the chain from it on could still add. */
interface Node {
  entry: Entry;
  next: Node | undefined;
  /** Gain this order and the rest could still add, ignoring what funds them. */
  positiveGain: bigint;
  /** The same with every gain priced, times `PRICE_SCALE`. */
  positivePriced: bigint;
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
  gain: bigint;
}

/** What the bot still holds of each asset. */
interface Balances {
  ckb: bigint;
  udt: bigint;
}

/** How many unused orders of a direction a node keeps as closers, per fill size. */
const CLOSERS = 2;

/** Search progress; the walk mutates it through its own methods. */
class Search {
  public best: { match: Match; gain: bigint } = {
    match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    gain: 0n,
  };
  public work = 0;
  /** The work the current walk may reach; once spent, unvisited subtrees only record their bound. */
  public limit: number;
  public exhausted = false;
  public unvisitedUpper = 0n;
  public readonly context: BestMatchContext;
  /** Every order, largest whole gain first, the directions interleaved. */
  public readonly entries: Entry[];
  /** Every order of each direction, largest whole gain first, for the closers. */
  public readonly buyers: Entry[];
  public readonly sellers: Entry[];
  /** What the two closers could add at most, on top of the orders still undecided. */
  public readonly closerUpper: bigint;
  public readonly closerPricedUpper: bigint;
  /** CKB and iCKB the whole book could hand the bot. */
  public readonly receivableCkb: bigint;
  public readonly receivableUdt: bigint;

  constructor(context: BestMatchContext) {
    this.context = context;
    this.limit = context.candidateBudget;
    const { prices } = context;
    this.entries = context.matchers.map((matcher) => {
      const full = fullFill(matcher);
      const gain = gainOf(context, full);
      const priced =
        gain * PRICE_SCALE +
        prices.udt * full.udtDelta +
        prices.ckb * (full.ckbDelta - context.ckbMiningFee);
      // The whole fill pays one unit of the bot's asset more than the ratio, rounded up,
      // so a partial can gain up to that unit converted at the order's ratio over the
      // whole fill's rate: pad by that much, at the exchange ratio and at the prices.
      const rounding = (matcher.bScale + matcher.aScale - 1n) / matcher.aScale;
      const [value, price] = matcher.isCkb2Udt
        ? [context.ckbScale, prices.ckb]
        : [context.udtScale, prices.udt];
      return {
        matcher,
        full,
        key: matcher.group.order.cell.outPoint.toHex(),
        gain,
        priced,
        padded: maxBigInt(gain + rounding * value, 0n),
        paddedPriced: maxBigInt(priced + rounding * (value * PRICE_SCALE + price), 0n),
      };
    });
    this.buyers = this.entries.filter((entry) => entry.matcher.isCkb2Udt);
    this.sellers = this.entries.filter((entry) => !entry.matcher.isCkb2Udt);
    const largest = (entries: Entry[], of: (entry: Entry) => bigint): bigint =>
      entries.reduce((most, entry) => maxBigInt(most, of(entry)), 0n);
    this.closerUpper =
      largest(this.buyers, (e) => e.padded) + largest(this.sellers, (e) => e.padded);
    this.closerPricedUpper =
      largest(this.buyers, (e) => e.paddedPriced) +
      largest(this.sellers, (e) => e.paddedPriced);
    this.receivableCkb = this.entries.reduce(
      (sum, entry) => sum + maxBigInt(entry.full.ckbDelta, 0n),
      0n,
    );
    this.receivableUdt = this.entries.reduce(
      (sum, entry) => sum + maxBigInt(entry.full.udtDelta, 0n),
      0n,
    );
  }

  /** Charges one unit of work; false once the limit is spent, recording the bound left behind. */
  public charge(upper: bigint): boolean {
    if (this.exhausted) {
      this.unvisitedUpper = maxBigInt(this.unvisitedUpper, upper);
      return false;
    }
    if (this.work >= this.limit) {
      this.exhausted = true;
      this.unvisitedUpper = upper;
      return false;
    }
    this.work += 1;
    return true;
  }

  /** Walks the orders in the given sequence from the initial state. */
  public walk(sequence: Entry[]): void {
    let next: Node | undefined;
    for (const entry of sequence.toReversed()) {
      next = {
        entry,
        next,
        positiveGain: (next?.positiveGain ?? 0n) + entry.padded,
        positivePriced: (next?.positivePriced ?? 0n) + entry.paddedPriced,
      };
    }
    visit(this, next, {
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      used: new Set(),
      reachableCkb: this.context.allowance.ckbValue + this.receivableCkb,
      reachableUdt: this.context.allowance.udtValue + this.receivableUdt,
    });
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
 * budget, charged per node and per closer examined, ends the search with the best
 * feasible match seen and the largest gain an unvisited branch could still hold
 * (decisions amendment 52).
 */
export function searchBestMatch(context: BestMatchContext): MatchSearchResult {
  const search = new Search(context);
  if (context.maxPartials !== 0) {
    // Largest gains first, keeping a tenth of the budget back: when that walk runs out,
    // a second one takes the smallest orders first, so a small cross the large orders'
    // subtrees hid is reached within a few nodes.
    search.limit = context.candidateBudget - Math.floor(context.candidateBudget / 10);
    search.walk(search.entries);
    if (search.exhausted) {
      search.exhausted = false;
      search.limit = context.candidateBudget;
      search.walk(
        search.entries.toSorted((left, right) =>
          compareBigInt(absBigInt(left.full.ckbDelta), absBigInt(right.full.ckbDelta)),
        ),
      );
    }
  }
  const diagnostics = context.diagnostics;
  diagnostics.workCount = search.work;
  diagnostics.bestGain = search.best.gain;
  diagnostics.gainUpperBound = maxBigInt(search.unvisitedUpper, search.best.gain);
  return {
    kind: search.exhausted ? "incomplete" : "complete",
    match: { ...search.best.match, diagnostics },
  };
}

function visit(search: Search, node: Node | undefined, state: State): void {
  const { context } = search;
  const { allowance, ckbMiningFee: fee, prices } = context;
  // Two bounds on what the subtree can reach, the plain one and the priced one, each
  // the state's gain plus what the undecided orders and the two closers could add.
  const gain = gainOf(context, state);
  const plain = gain + (node?.positiveGain ?? 0n) + search.closerUpper;
  const priced =
    gain * PRICE_SCALE +
    prices.udt * (allowance.udtValue + state.udtDelta) +
    prices.ckb *
      (allowance.ckbValue + state.ckbDelta - fee * BigInt(state.partials.length)) +
    (node?.positivePriced ?? 0n) +
    search.closerPricedUpper;
  const upper = minBigInt(plain, priced / PRICE_SCALE + 1n);
  if (!search.charge(upper)) {
    return;
  }
  search.record(closed(search, state, upper));
  if (node === undefined || upper <= search.best.gain) {
    return;
  }
  const { full, key } = node.entry;
  const reachableCkb = state.reachableCkb + minBigInt(full.ckbDelta, 0n) - fee;
  const reachableUdt = state.reachableUdt + minBigInt(full.udtDelta, 0n);
  const take = (): void => {
    if (
      state.used.has(key) ||
      !hasSlot(context, state, 1) ||
      reachableCkb < 0n ||
      reachableUdt < 0n
    ) {
      return;
    }
    state.used.add(key);
    state.partials.push(...full.partials);
    visit(search, node.next, {
      ...state,
      ckbDelta: state.ckbDelta + full.ckbDelta,
      udtDelta: state.udtDelta + full.udtDelta,
      reachableCkb,
      reachableUdt,
    });
    state.partials.pop();
    state.used.delete(key);
  };
  const skip = (): void => {
    visit(search, node.next, state);
  };
  // Take first only when the order gains net of what it takes at the asset prices;
  // otherwise the rest of the book is worth more without it, and the walk finds that
  // incumbent before the priced bound closes the subtree that holds this order.
  for (const child of node.entry.priced >= 0n ? [take, skip] : [skip, take]) {
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
  // The unused orders of one direction whose fill at the given size gains most, each
  // probed once as it is examined. The list is sorted by whole gain, so once the kept
  // fills gain and no order left gains as much whole the scan stops; a smaller fill can
  // beat its whole fill by one rounding unit of value, which the stop accepts losing.
  const pick = (
    entries: Entry[],
    size: (matcher: OrderMatcher) => bigint | undefined,
    except: string | undefined,
  ): Fill[] => {
    const picked: Fill[] = [];
    for (const entry of entries) {
      const worst = picked[CLOSERS - 1];
      if (worst !== undefined && worst.gain > 0n && entry.gain <= worst.gain) {
        break;
      }
      if (!search.charge(upper)) {
        break;
      }
      if (state.used.has(entry.key) || entry.key === except) {
        continue;
      }
      const payment = size(entry.matcher);
      if (payment === undefined) {
        continue;
      }
      const fill = entry.matcher.match(payment);
      const gain = gainOf(context, fill);
      const at = picked.findIndex((kept) => kept.gain < gain);
      picked.splice(at === -1 ? picked.length : at, 0, { key: entry.key, fill, gain });
      picked.length = Math.min(picked.length, CLOSERS);
    }
    return picked;
  };
  // Fills of the best unused orders of one direction: the largest the budget pays, and
  // the smallest that repairs the given deficit of the asset the order hands back.
  const fills = (
    entries: Entry[],
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
    return sizes.flatMap((size) => pick(entries, size, except));
  };
  // Closers of one direction paid from what is left: buyers spend the iCKB and must
  // repair a CKB deficit, sellers the reverse, each fill's fee taken off the CKB first.
  const closers = (left: Balances, isBuyer: boolean, except?: string): Fill[] =>
    isBuyer
      ? fills(search.buyers, left.udt, fee - left.ckb, except)
      : fills(search.sellers, left.ckb - fee, -left.udt, except);
  const left = { ckb: ckbLeft, udt: udtLeft };
  consider([]);
  for (const isBuyer of [true, false]) {
    for (const { key, fill } of closers(left, isBuyer)) {
      consider([fill]);
      const after = {
        ckb: left.ckb - fee + fill.ckbDelta,
        udt: left.udt + fill.udtDelta,
      };
      for (const other of closers(after, !isBuyer, key)) {
        consider([fill, other.fill]);
      }
    }
  }
  return best;
}

/** The smallest payment that hands back at least `deficit` of the order's asset. */
function repairingPayment(matcher: OrderMatcher, deficit: bigint): bigint {
  return (deficit * matcher.aScale + matcher.bScale - 1n) / matcher.bScale;
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

function hasSlot(context: BestMatchContext, state: State, needed: number): boolean {
  return (
    context.maxPartials === undefined ||
    state.partials.length + needed <= context.maxPartials
  );
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return compareBigInt(left, right) > 0 ? left : right;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return compareBigInt(left, right) < 0 ? left : right;
}
