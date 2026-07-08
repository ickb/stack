import { BufferedGenerator } from "@ickb/utils";
import type { Match } from "./match_types.ts";
import type { BestMatchContext } from "./order_match_context.ts";
import { sequentialMatches } from "./order_match_sequence.ts";
import {
  hasUniquePartialOrderOutPoints,
  partialOutPointKeys,
} from "./order_match_uniqueness.ts";
import type { OrderMatcher } from "./order_matcher.ts";

interface MatchSearchState {
  advance: MatchAdvance;
  best: MatchCandidate;
}

interface MatchPair {
  c2u: Match;
  u2c: Match;
}

interface MatchSearchPosition {
  i: number;
  j: number;
}

interface MatchCandidateInput extends MatchPair {
  next?: MatchSearchPosition;
}

interface MatchBudgetExtensionInput extends MatchPair {
  budgetKind: "ckb" | "udt";
  excluded: Set<string>;
}

interface MatchAdvance {
  i: number;
  j: number;
  gain: bigint;
}

interface MatchCandidate extends Match {
  gain: bigint;
}

export function searchBestMatch(context: BestMatchContext): Match {
  const ckb2UdtMatches = new BufferedGenerator(
    sequentialMatches(context.ckbToUdtMatchers, context.udtAllowanceStep),
    2,
  );
  const udt2CkbMatches = new BufferedGenerator(
    sequentialMatches(context.udtToCkbMatchers, context.ckbAllowanceStep),
    2,
  );
  let state: MatchSearchState = {
    advance: initialMatchAdvance(),
    best: { ...emptyMatch(), gain: 0n },
  };

  while (state.advance.i !== 0 || state.advance.j !== 0) {
    ckb2UdtMatches.next(state.advance.i);
    udt2CkbMatches.next(state.advance.j);
    state = visitMatchFrontier(
      context,
      { ...state, advance: neutralMatchAdvance() },
      ckb2UdtMatches.buffer,
      udt2CkbMatches.buffer,
    );
  }

  const diagnostics = context.diagnostics;
  diagnostics.candidates.bestGain = state.best.gain;
  return {
    ckbDelta: state.best.ckbDelta,
    udtDelta: state.best.udtDelta,
    partials: state.best.partials,
    diagnostics: context.diagnostics,
  };
}

function emptyMatch(): Match {
  return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
}

function initialMatchAdvance(): MatchAdvance {
  return { i: -1, j: -1, gain: minimumGain() };
}

function neutralMatchAdvance(): MatchAdvance {
  return { i: 0, j: 0, gain: minimumGain() };
}

function minimumGain(): bigint {
  return -1n << 256n;
}

function visitMatchFrontier(
  context: BestMatchContext,
  state: MatchSearchState,
  ckb2UdtMatches: readonly Match[],
  udt2CkbMatches: readonly Match[],
): MatchSearchState {
  let nextState = state;
  for (const [i, c2u] of ckb2UdtMatches.entries()) {
    for (const [j, u2c] of udt2CkbMatches.entries()) {
      nextState = visitMatchPair(context, nextState, { c2u, u2c }, { i, j });
    }
  }
  return nextState;
}

function visitMatchPair(
  context: BestMatchContext,
  state: MatchSearchState,
  pair: MatchPair,
  next: MatchSearchPosition,
): MatchSearchState {
  const { c2u, u2c } = pair;
  const partials = c2u.partials.concat(u2c.partials);
  let nextState = considerMatchCandidate(context, state, { ...pair, next });
  if (context.maxPartials !== undefined && partials.length >= context.maxPartials) {
    return nextState;
  }

  const excluded = partialOutPointKeys(partials);
  nextState = considerBudgetExtension(context, nextState, {
    ...pair,
    excluded,
    budgetKind: "ckb",
  });
  return considerBudgetExtension(context, nextState, {
    ...pair,
    excluded,
    budgetKind: "udt",
  });
}

function considerBudgetExtension(
  context: BestMatchContext,
  state: MatchSearchState,
  { c2u, u2c, excluded, budgetKind }: MatchBudgetExtensionInput,
): MatchSearchState {
  const extension =
    budgetKind === "ckb"
      ? ckbBudgetExtension(context, u2c, c2u, excluded)
      : udtBudgetExtension(context, c2u, u2c, excluded);
  if (extension === undefined) {
    return state;
  }
  return considerMatchCandidate(
    context,
    state,
    budgetKind === "ckb" ? { c2u, u2c: extension } : { c2u: extension, u2c },
  );
}

function ckbBudgetExtension(
  context: BestMatchContext,
  u2c: Match,
  c2u: Match,
  excluded: Set<string>,
): Match | undefined {
  const partialCount = c2u.partials.length + u2c.partials.length;
  const nextPartialFee = context.ckbMiningFee * BigInt(partialCount + 1);
  const budget =
    context.allowance.ckbValue + c2u.ckbDelta + u2c.ckbDelta - nextPartialFee;
  return budget > 0n && budget < context.ckbAllowanceStep
    ? extendMatch(u2c, context.udtToCkbMatchers, budget, excluded)
    : undefined;
}

function udtBudgetExtension(
  context: BestMatchContext,
  c2u: Match,
  u2c: Match,
  excluded: Set<string>,
): Match | undefined {
  const budget = context.allowance.udtValue + c2u.udtDelta + u2c.udtDelta;
  return budget > 0n && budget < context.udtAllowanceStep
    ? extendMatch(c2u, context.ckbToUdtMatchers, budget, excluded)
    : undefined;
}

function considerMatchCandidate(
  context: BestMatchContext,
  state: MatchSearchState,
  { c2u, u2c, next }: MatchCandidateInput,
): MatchSearchState {
  const candidate = matchCandidate(context, c2u, u2c);
  const candidates = context.diagnostics.candidates;
  candidates.total += 1;
  if (!isViableMatchCandidate(context, candidate)) {
    return state;
  }

  candidates.viable += 1;
  const advance =
    next !== undefined && candidate.gain > state.advance.gain
      ? { ...next, gain: candidate.gain }
      : state.advance;
  if (!isPositiveMatchCandidate(context, candidate)) {
    return { ...state, advance };
  }
  return candidate.gain > state.best.gain
    ? { advance, best: candidate }
    : { ...state, advance };
}

function matchCandidate(
  context: BestMatchContext,
  c2u: Match,
  u2c: Match,
): MatchCandidate {
  const ckbDelta = c2u.ckbDelta + u2c.ckbDelta;
  const udtDelta = c2u.udtDelta + u2c.udtDelta;
  const partials = c2u.partials.concat(u2c.partials);
  const ckbFee = context.ckbMiningFee * BigInt(partials.length);
  return {
    ckbDelta,
    udtDelta,
    partials,
    gain: (ckbDelta - ckbFee) * context.ckbScale + udtDelta * context.udtScale,
  };
}

function isViableMatchCandidate(
  context: BestMatchContext,
  candidate: MatchCandidate,
): boolean {
  if (
    context.maxPartials !== undefined &&
    candidate.partials.length > context.maxPartials
  ) {
    const rejected = context.diagnostics.candidates.rejected;
    rejected.maxPartials += 1;
    return false;
  }

  const rejected = context.diagnostics.candidates.rejected;
  if (!hasUniquePartialOrderOutPoints(candidate.partials)) {
    rejected.duplicateOrder += 1;
    return false;
  }

  return hasCandidateAllowance(context, candidate);
}

function hasCandidateAllowance(
  context: BestMatchContext,
  candidate: MatchCandidate,
): boolean {
  const rejected = context.diagnostics.candidates.rejected;
  const ckbFee = context.ckbMiningFee * BigInt(candidate.partials.length);
  const ckbAllowance = context.allowance.ckbValue + candidate.ckbDelta - ckbFee;
  const udtAllowance = context.allowance.udtValue + candidate.udtDelta;
  if (ckbAllowance < 0n) {
    rejected.insufficientCkbAllowance += 1;
  } else if (udtAllowance < 0n) {
    rejected.insufficientUdtAllowance += 1;
  }
  return ckbAllowance >= 0n && udtAllowance >= 0n;
}

function isPositiveMatchCandidate(
  context: BestMatchContext,
  candidate: MatchCandidate,
): boolean {
  if (candidate.partials.length === 0) {
    return true;
  }

  const candidates = context.diagnostics.candidates;
  if (candidate.gain > 0n) {
    candidates.positiveGain += 1;
    return true;
  }
  candidates.rejected.nonPositiveGain += 1;
  return false;
}

function extendMatch(
  base: Match,
  matchers: OrderMatcher[],
  allowance: bigint,
  excludedOutPoints: Set<string>,
): Match | undefined {
  for (const matcher of matchers) {
    if (excludedOutPoints.has(matcher.order.cell.outPoint.toHex())) {
      continue;
    }
    const probe = matcher.match(allowance);
    if (probe.partials.length === 0) {
      continue;
    }
    return {
      ckbDelta: base.ckbDelta + probe.ckbDelta,
      udtDelta: base.udtDelta + probe.udtDelta,
      partials: base.partials.concat(probe.partials),
    };
  }
  return undefined;
}
