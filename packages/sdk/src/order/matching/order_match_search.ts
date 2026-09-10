import type { Match, MatchSearchPhase, MatchSearchResult } from "./match_types.ts";
import type { BestMatchContext } from "./order_match_context.ts";
import {
  directionalMatchFrontier,
  matcherAllowanceCount,
} from "./order_match_sequence.ts";
import {
  hasUniquePartialOrderOutPoints,
  partialOutPointKeys,
} from "./order_match_uniqueness.ts";
import type { OrderMatcher } from "./order_matcher.ts";

interface MatchPair {
  c2u: Match;
  u2c: Match;
}

interface MatchCandidate extends Match {
  gain: bigint;
}

interface SearchState {
  best: MatchCandidate;
  truncation: { phase: MatchSearchPhase; requiredWork: bigint };
}

interface DirectionWorkBound {
  inspections: bigint;
  probes: bigint;
  statesByPartials: bigint[];
}

interface BudgetExtensionsInput {
  allowance: bigint;
  base: Match;
  direction: "c2u" | "u2c";
  excludedOutPoints: Set<string>;
  matchers: OrderMatcher[];
  pair: MatchPair;
}

interface FrontierPairsInput {
  ckb2UdtMatches: Match[];
  searchMode: "atomic" | "stepped";
  udt2CkbMatches: Match[];
}

export function searchBestMatch(context: BestMatchContext): MatchSearchResult {
  const preflightWork = atomicSearchWorkUpperBound(context);
  const searchMode =
    preflightWork <= BigInt(context.candidateBudget) ? "atomic" : "stepped";
  const state: SearchState = {
    best: { ...emptyMatch(), gain: 0n },
    truncation: { phase: "preflight", requiredWork: preflightWork },
  };
  claimCandidateWork(context, state);
  evaluateCandidate(context, state, { c2u: emptyMatch(), u2c: emptyMatch() });

  // Each direction is capped at what the bot could fund in the best case: its allowance
  // plus everything the other direction's orders could hand it. States no combination
  // can fund are never generated (decisions amendment 52).
  const ckb2Udt = directionalMatchFrontier(context.ckbToUdtMatchers, {
    allowanceCap: udtAllowanceCap(context),
    allowanceStep: context.udtAllowanceStep,
    claimWork: (count) => claimWork(context, state, "ckbToUdtFrontier", count),
    isCkb2Udt: true,
    maxPartials: context.maxPartials,
    onState: (match) => {
      evaluateCandidate(context, state, { c2u: match, u2c: emptyMatch() });
    },
    searchMode,
  });
  const diagnostics = context.diagnostics;
  diagnostics.generatedStates.ckbToUdt = ckb2Udt.matches.length;
  if (!ckb2Udt.completed) {
    return incompleteResult(context, state, searchMode);
  }

  const udt2Ckb = directionalMatchFrontier(context.udtToCkbMatchers, {
    allowanceCap: ckbAllowanceCap(context),
    allowanceStep: context.ckbAllowanceStep,
    claimWork: (count) => claimWork(context, state, "udtToCkbFrontier", count),
    isCkb2Udt: false,
    maxPartials: context.maxPartials,
    onState: (match) => {
      evaluateCandidate(context, state, { c2u: emptyMatch(), u2c: match });
    },
    searchMode,
  });
  diagnostics.generatedStates.udtToCkb = udt2Ckb.matches.length;
  if (!udt2Ckb.completed) {
    return incompleteResult(context, state, searchMode);
  }

  if (
    !visitFrontierPairs(context, state, {
      ckb2UdtMatches: ckb2Udt.matches,
      searchMode,
      udt2CkbMatches: udt2Ckb.matches,
    })
  ) {
    return incompleteResult(context, state, searchMode);
  }

  const match = completedMatch(context, state);
  return searchMode === "atomic"
    ? { kind: "complete", match }
    : {
        kind: "incomplete",
        match,
        reason: "atomic_domain_exceeds_budget",
        searchMode: "stepped",
        budget: context.candidateBudget,
        work: context.diagnostics.workCount,
        truncation: { phase: "preflight", requiredWork: preflightWork },
      };
}

function visitFrontierPairs(
  context: BestMatchContext,
  state: SearchState,
  input: FrontierPairsInput,
): boolean {
  if (!canCombineDirections(context)) {
    return true;
  }
  return (
    (input.searchMode === "atomic" ||
      (visitSteppedDirectionalStates(context, state, input, true) &&
        visitSteppedDirectionalStates(context, state, input, false))) &&
    visitCrossDirectionPairs(context, state, input)
  );
}

function visitSteppedDirectionalStates(
  context: BestMatchContext,
  state: SearchState,
  input: FrontierPairsInput,
  isCkb2Udt: boolean,
): boolean {
  const empty = emptyMatch();
  const matches = isCkb2Udt ? input.ckb2UdtMatches : input.udt2CkbMatches;
  for (const match of matches) {
    if (match.partials.length === 0) {
      continue;
    }
    const pair = isCkb2Udt ? { c2u: match, u2c: empty } : { c2u: empty, u2c: match };
    if (!visitFrontierPair(context, state, pair, input.searchMode)) {
      return false;
    }
  }
  return true;
}

function visitCrossDirectionPairs(
  context: BestMatchContext,
  state: SearchState,
  input: FrontierPairsInput,
): boolean {
  for (const c2u of input.ckb2UdtMatches) {
    if (c2u.partials.length === 0) {
      continue;
    }
    for (const u2c of input.udt2CkbMatches) {
      if (!claimCandidateWork(context, state)) {
        return false;
      }
      if (u2c.partials.length === 0) {
        continue;
      }
      if (!visitFrontierPair(context, state, { c2u, u2c }, input.searchMode)) {
        return false;
      }
    }
  }
  return true;
}

function visitFrontierPair(
  context: BestMatchContext,
  state: SearchState,
  pair: MatchPair,
  searchMode: "atomic" | "stepped",
): boolean {
  if (!isKnownPossiblePair(context, pair)) {
    return true;
  }
  const hasBothDirections = pair.c2u.partials.length > 0 && pair.u2c.partials.length > 0;
  if (hasBothDirections) {
    evaluateCandidate(context, state, pair);
  }
  return searchMode === "atomic" || visitResidualExtensions(context, state, pair);
}

function visitResidualExtensions(
  context: BestMatchContext,
  state: SearchState,
  pair: MatchPair,
): boolean {
  const partials = pair.c2u.partials.concat(pair.u2c.partials);
  if (context.maxPartials !== undefined && partials.length >= context.maxPartials) {
    return true;
  }
  const excluded = partialOutPointKeys(partials);
  const ckbBudget = ckbExtensionBudget(context, pair);
  if (
    ckbBudget !== undefined &&
    !visitBudgetExtensions(context, state, {
      allowance: ckbBudget,
      base: pair.u2c,
      direction: "u2c",
      excludedOutPoints: excluded,
      matchers: context.udtToCkbMatchers,
      pair,
    })
  ) {
    return false;
  }
  const udtBudget = udtExtensionBudget(context, pair);
  return (
    udtBudget === undefined ||
    visitBudgetExtensions(context, state, {
      allowance: udtBudget,
      base: pair.c2u,
      direction: "c2u",
      excludedOutPoints: excluded,
      matchers: context.ckbToUdtMatchers,
      pair,
    })
  );
}

function visitBudgetExtensions(
  context: BestMatchContext,
  state: SearchState,
  input: BudgetExtensionsInput,
): boolean {
  for (const matcher of input.matchers) {
    if (!claimCandidateWork(context, state)) {
      return false;
    }
    if (input.excludedOutPoints.has(matcher.group.order.cell.outPoint.toHex())) {
      const rejected = context.diagnostics.candidates.rejected;
      rejected.duplicateOrder += 1;
      continue;
    }
    const probe = matcher.match(input.allowance);
    if (probe.partials.length === 0) {
      continue;
    }
    const extension = {
      ckbDelta: input.base.ckbDelta + probe.ckbDelta,
      udtDelta: input.base.udtDelta + probe.udtDelta,
      partials: input.base.partials.concat(probe.partials),
    };
    evaluateCandidate(
      context,
      state,
      input.direction === "c2u"
        ? { ...input.pair, c2u: extension }
        : { ...input.pair, u2c: extension },
    );
  }
  return true;
}

function claimCandidateWork(context: BestMatchContext, state: SearchState): boolean {
  if (!claimWork(context, state, "candidates", 1n)) {
    return false;
  }
  const candidates = context.diagnostics.candidates;
  candidates.total += 1;
  return true;
}

function evaluateCandidate(
  context: BestMatchContext,
  state: SearchState,
  { c2u, u2c }: MatchPair,
): void {
  const candidate = matchCandidate(context, c2u, u2c);
  const candidates = context.diagnostics.candidates;
  if (!isViableMatchCandidate(context, candidate)) {
    return;
  }
  candidates.viable += 1;
  if (!isPositiveMatchCandidate(context, candidate)) {
    return;
  }
  if (candidate.gain > state.best.gain) {
    const mutableState = state;
    mutableState.best = candidate;
  }
}

function claimWork(
  context: BestMatchContext,
  state: SearchState,
  phase: MatchSearchPhase,
  count: bigint,
): boolean {
  const requiredWork = BigInt(context.diagnostics.workCount) + count;
  if (requiredWork > BigInt(context.candidateBudget)) {
    const mutableState = state;
    mutableState.truncation = { phase, requiredWork };
    return false;
  }
  const diagnostics = context.diagnostics;
  diagnostics.workCount = Number(requiredWork);
  return true;
}

function incompleteResult(
  context: BestMatchContext,
  state: SearchState,
  searchMode: "atomic" | "stepped",
): MatchSearchResult {
  return {
    kind: "incomplete",
    match: completedMatch(context, state),
    reason: "candidate_budget_exhausted",
    searchMode,
    budget: context.candidateBudget,
    work: context.diagnostics.workCount,
    truncation: state.truncation,
  };
}

function completedMatch(context: BestMatchContext, state: SearchState): Match {
  const diagnostics = context.diagnostics;
  diagnostics.candidates.bestGain = state.best.gain;
  return {
    ckbDelta: state.best.ckbDelta,
    udtDelta: state.best.udtDelta,
    partials: state.best.partials,
    diagnostics,
  };
}

function atomicSearchWorkUpperBound(context: BestMatchContext): bigint {
  const maxPartials = Math.min(maximumPartialCount(context), context.candidateBudget);
  if (maxPartials === 0) {
    return 1n;
  }
  const limit = BigInt(context.candidateBudget) + 1n;
  const c2u = directionWorkBound(
    context.ckbToUdtMatchers,
    udtAllowanceCap(context),
    maxPartials,
    limit,
  );
  const u2c = directionWorkBound(
    context.udtToCkbMatchers,
    ckbAllowanceCap(context),
    maxPartials,
    limit,
  );
  const cross =
    maxPartials < 2
      ? 0n
      : cappedMultiply(
          cappedStateCount(c2u.statesByPartials, 1, limit),
          cappedStateCount(u2c.statesByPartials, 0, limit),
          limit,
        );
  return cappedAdd(
    1n,
    cappedAdd(
      c2u.probes + u2c.probes,
      cappedAdd(c2u.inspections + u2c.inspections, cross, limit),
      limit,
    ),
    limit,
  );
}

function directionWorkBound(
  matchers: OrderMatcher[],
  allowanceCap: bigint,
  maxPartials: number,
  limit: bigint,
): DirectionWorkBound {
  let statesByPartials = [1n, ...Array.from({ length: maxPartials }, () => 0n)];
  let probes = 0n;
  let inspections = 0n;
  for (const matcher of matchers) {
    const choices = matcherAllowanceCount(matcher, allowanceCap);
    if (choices === 0n) {
      continue;
    }
    probes = cappedAdd(probes, choices, limit);
    inspections = cappedAdd(
      inspections,
      cappedMultiply(cappedStateCount(statesByPartials, 1, limit), choices, limit),
      limit,
    );
    if (probes === limit || inspections === limit) {
      return { inspections, probes, statesByPartials };
    }
    const nextStates = [1n];
    let previous = 0n;
    for (const [partials, current] of statesByPartials.entries()) {
      if (partials === 0) {
        previous = current;
        continue;
      }
      const additions = cappedMultiply(previous, choices, limit);
      nextStates.push(cappedAdd(current, additions, limit));
      previous = current;
    }
    statesByPartials = nextStates;
  }
  return { inspections, probes, statesByPartials };
}

function cappedAdd(left: bigint, right: bigint, limit: bigint): bigint {
  const value = left + right;
  return value < limit ? value : limit;
}

function cappedMultiply(left: bigint, right: bigint, limit: bigint): bigint {
  if (left === 0n || right === 0n) {
    return 0n;
  }
  return left > limit / right ? limit : left * right;
}

function cappedStateCount(states: bigint[], start: number, limit: bigint): bigint {
  let count = 0n;
  for (const [index, state] of states.entries()) {
    if (index < start) {
      continue;
    }
    count = cappedAdd(count, state, limit);
  }
  return count;
}

function isKnownPossiblePair(context: BestMatchContext, pair: MatchPair): boolean {
  const partials = pair.c2u.partials.concat(pair.u2c.partials);
  const rejected = context.diagnostics.candidates.rejected;
  if (context.maxPartials !== undefined && partials.length > context.maxPartials) {
    rejected.maxPartials += 1;
    return false;
  }
  if (!hasUniquePartialOrderOutPoints(partials)) {
    rejected.duplicateOrder += 1;
    return false;
  }
  return true;
}

function canCombineDirections(context: BestMatchContext): boolean {
  return maximumPartialCount(context) >= 2;
}

function maximumPartialCount(context: BestMatchContext): number {
  return Math.min(
    context.maxPartials ?? context.diagnostics.orderCount,
    context.diagnostics.orderCount,
  );
}

function ckbExtensionBudget(
  context: BestMatchContext,
  { c2u, u2c }: MatchPair,
): bigint | undefined {
  const partialCount = c2u.partials.length + u2c.partials.length;
  const nextPartialFee = context.ckbMiningFee * BigInt(partialCount + 1);
  const budget =
    context.allowance.ckbValue + c2u.ckbDelta + u2c.ckbDelta - nextPartialFee;
  return budget > 0n && budget < context.ckbAllowanceStep ? budget : undefined;
}

function udtExtensionBudget(
  context: BestMatchContext,
  { c2u, u2c }: MatchPair,
): bigint | undefined {
  const budget = context.allowance.udtValue + c2u.udtDelta + u2c.udtDelta;
  return budget > 0n && budget < context.udtAllowanceStep ? budget : undefined;
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
  if (candidate.gain > 0n) {
    const candidates = context.diagnostics.candidates;
    candidates.positiveGain += 1;
    return true;
  }
  const rejected = context.diagnostics.candidates.rejected;
  rejected.nonPositiveGain += 1;
  return false;
}

/** CKB the bot could spend on sellers: its allowance after the mining fee, plus what buyers pay it. */
function ckbAllowanceCap(context: BestMatchContext): bigint {
  const own = context.allowance.ckbValue - context.ckbMiningFee;
  return (own > 0n ? own : 0n) + supply(context.ckbToUdtMatchers);
}

/** iCKB the bot could spend on buyers: its allowance plus what sellers hand it. */
function udtAllowanceCap(context: BestMatchContext): bigint {
  return context.allowance.udtValue + supply(context.udtToCkbMatchers);
}

/** The most the bot can receive from these orders: each order's whole offered side. */
function supply(matchers: readonly OrderMatcher[]): bigint {
  return matchers.reduce((sum, matcher) => sum + matcher.aIn, 0n);
}

function emptyMatch(): Match {
  return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
}
