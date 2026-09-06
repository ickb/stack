import type { ccc } from "@ckb-ccc/core";
import { compareBigInt } from "../../utils/index.ts";
import type { OrderGroup } from "../model/cells.ts";
import type { Match, MatchDirectionDiagnostics } from "./match_types.ts";
import { OrderMatcher } from "./order_matcher.ts";

const MAX_STEPPED_GRID_PROBES = 1024;

interface FrontierState {
  key: string;
  match: Match;
  ordinal: number;
  received: bigint;
  spent: bigint;
}

interface FrontierExpansion {
  completed: boolean;
  frontier: FrontierState[];
  ordinal: number;
}

interface ChoiceExpansionInput {
  choice: Match;
  initialOrdinal: number;
  options: DirectionalFrontierOptions;
  originalCount: number;
  outPoint: string;
}

export interface DirectionalFrontierOptions {
  allowanceCap?: bigint;
  allowanceStep: bigint;
  claimWork: (count: bigint) => boolean;
  isCkb2Udt: boolean;
  maxPartials?: number;
  onState: (match: Match) => void;
  searchMode: "atomic" | "stepped";
}

export interface DirectionalFrontierResult {
  completed: boolean;
  matches: Match[];
}

export function orderMatchers(
  orderPool: OrderGroup[],
  isCkb2Udt: boolean,
  ckbMiningFee: ccc.FixedPoint,
): OrderMatcher[] {
  return orderPool
    .map((group) => OrderMatcher.from(group, isCkb2Udt, ckbMiningFee))
    .filter((matcher): matcher is OrderMatcher => matcher !== undefined)
    .toSorted((a, b) => OrderMatcher.compareRealRatioDesc(a, b));
}

export function directionalMatchFrontier(
  matchers: OrderMatcher[],
  options: DirectionalFrontierOptions,
): DirectionalFrontierResult {
  let ordinal = 1;
  const maxPartials = options.maxPartials;
  let frontier: FrontierState[] = [frontierState(emptyMatch(), "", 0, options.isCkb2Udt)];
  for (const matcher of matchers) {
    if (maxPartials === 0) {
      break;
    }
    const expansion = expandMatcherFrontier(frontier, matcher, options, ordinal);
    if (!expansion.completed) {
      return { completed: false, matches: frontierMatches(expansion.frontier) };
    }
    frontier = nondominatedStates(expansion.frontier);
    ordinal = expansion.ordinal;
  }
  return { completed: true, matches: frontierMatches(frontier) };
}

function expandMatcherFrontier(
  frontier: FrontierState[],
  matcher: OrderMatcher,
  options: DirectionalFrontierOptions,
  initialOrdinal: number,
): FrontierExpansion {
  const maxAllowance = minBigInt(matcher.bMaxMatch, options.allowanceCap);
  if (maxAllowance < matcher.bMinMatch) {
    return { completed: true, frontier, ordinal: initialOrdinal };
  }
  const originalCount = frontier.length;
  let ordinal = initialOrdinal;
  for (const allowance of probeAllowances(matcher, maxAllowance, options)) {
    if (!options.claimWork(1n)) {
      return { completed: false, frontier, ordinal };
    }
    const choice = matcher.match(allowance);
    if (choice.partials.length === 0) {
      continue;
    }
    const expansion = expandChoice(frontier, {
      choice,
      initialOrdinal: ordinal,
      options,
      originalCount,
      outPoint: matcher.group.order.cell.outPoint.toHex(),
    });
    if (!expansion.completed) {
      return expansion;
    }
    ordinal = expansion.ordinal;
  }
  return { completed: true, frontier, ordinal };
}

function expandChoice(
  frontier: FrontierState[],
  input: ChoiceExpansionInput,
): FrontierExpansion {
  let ordinal = input.initialOrdinal;
  frontier.push(
    frontierState(input.choice, `|${input.outPoint}`, ordinal, input.options.isCkb2Udt),
  );
  ordinal += 1;
  input.options.onState(input.choice);
  for (const [index, state] of frontier.entries()) {
    if (index >= input.originalCount) {
      break;
    }
    if (state.match.partials.length === 0) {
      continue;
    }
    if (!input.options.claimWork(1n)) {
      return { completed: false, frontier, ordinal };
    }
    if (!canExpandState(state, input.outPoint, input.options.maxPartials)) {
      continue;
    }
    const match = {
      ckbDelta: state.match.ckbDelta + input.choice.ckbDelta,
      udtDelta: state.match.udtDelta + input.choice.udtDelta,
      partials: state.match.partials.concat(input.choice.partials),
    };
    frontier.push(
      frontierState(
        match,
        `${state.key}|${input.outPoint}`,
        ordinal,
        input.options.isCkb2Udt,
      ),
    );
    ordinal += 1;
    input.options.onState(match);
  }
  return { completed: true, frontier, ordinal };
}

function canExpandState(
  state: FrontierState,
  outPoint: string,
  maxPartials: number | undefined,
): boolean {
  return (
    (maxPartials === undefined || state.match.partials.length < maxPartials) &&
    state.match.partials.every(
      (partial) => partial.group.order.cell.outPoint.toHex() !== outPoint,
    )
  );
}

export function matcherAllowanceCount(
  matcher: OrderMatcher,
  allowanceCap?: bigint,
): bigint {
  const maxAllowance = minBigInt(matcher.bMaxMatch, allowanceCap);
  return maxAllowance < matcher.bMinMatch ? 0n : maxAllowance - matcher.bMinMatch + 1n;
}

function* probeAllowances(
  matcher: OrderMatcher,
  maxAllowance: bigint,
  options: DirectionalFrontierOptions,
): Generator<bigint, void, void> {
  yield matcher.bMinMatch;
  if (maxAllowance !== matcher.bMinMatch) {
    yield maxAllowance;
  }
  const step = options.searchMode === "atomic" ? 1n : options.allowanceStep;
  let allowance = ceilToStep(matcher.bMinMatch, step);
  let gridProbes = 0;
  while (
    allowance <= maxAllowance &&
    (options.searchMode === "atomic" || gridProbes < MAX_STEPPED_GRID_PROBES)
  ) {
    if (allowance !== matcher.bMinMatch && allowance !== maxAllowance) {
      yield allowance;
      gridProbes += 1;
    }
    allowance += step;
  }
}

function ceilToStep(value: bigint, step: bigint): bigint {
  return ((value + step - 1n) / step) * step;
}

function frontierMatches(frontier: FrontierState[]): Match[] {
  return frontier.map((state) => state.match);
}

function nondominatedStates(states: FrontierState[]): FrontierState[] {
  const byKey = new Map<string, FrontierState[]>();
  for (const state of states) {
    const group = byKey.get(state.key) ?? [];
    group.push(state);
    byKey.set(state.key, group);
  }
  const retained: FrontierState[] = [];
  for (const group of byKey.values()) {
    group.sort((left, right) => {
      if (left.spent !== right.spent) {
        return compareBigInt(left.spent, right.spent);
      }
      const receivedOrder = compareBigInt(right.received, left.received);
      return receivedOrder === 0 ? left.ordinal - right.ordinal : receivedOrder;
    });
    let bestReceived = -1n;
    for (const state of group) {
      if (state.received <= bestReceived) {
        continue;
      }
      bestReceived = state.received;
      retained.push(state);
    }
  }
  return retained.toSorted((left, right) => left.ordinal - right.ordinal);
}

function frontierState(
  match: Match,
  key: string,
  ordinal: number,
  isCkb2Udt: boolean,
): FrontierState {
  return {
    key,
    match,
    ordinal,
    received: receivedAmount(match, isCkb2Udt),
    spent: isCkb2Udt ? -match.udtDelta : -match.ckbDelta,
  };
}

function receivedAmount(match: Match, isCkb2Udt: boolean): bigint {
  return isCkb2Udt ? match.ckbDelta : match.udtDelta;
}

function minBigInt(left: bigint, right: bigint | undefined): bigint {
  return right === undefined || left < right ? left : right;
}

export function summarizeMatchers(matchers: OrderMatcher[]): MatchDirectionDiagnostics {
  const matchableCount = matchers.length;
  let minAllowance: ccc.FixedPoint | undefined;
  let maxMatch: ccc.FixedPoint | undefined;
  for (const matcher of matchers) {
    minAllowance =
      minAllowance === undefined || compareBigInt(matcher.bMinMatch, minAllowance) < 0
        ? matcher.bMinMatch
        : minAllowance;
    maxMatch =
      maxMatch === undefined || compareBigInt(matcher.bMaxMatch, maxMatch) > 0
        ? matcher.bMaxMatch
        : maxMatch;
  }

  return {
    matchableCount,
    ...(minAllowance === undefined ? {} : { minAllowance }),
    ...(maxMatch === undefined ? {} : { maxMatch }),
  };
}

function emptyMatch(): Match {
  return { ckbDelta: 0n, udtDelta: 0n, partials: [] };
}
