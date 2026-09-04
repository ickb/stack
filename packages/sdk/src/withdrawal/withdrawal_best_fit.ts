import { MAX_WITHDRAWAL_REQUESTS } from "../client/sdk_types.ts";
import {
  findBestAtOrBelow,
  isBetterSelection,
  pickBetterSelection,
  prepareSelections,
  selectByMasks,
  selectGreedyDeposits,
} from "./withdrawal_best_fit_support.ts";

export const BEST_FIT_SEARCH_CANDIDATES = 30;

interface PartialSelection {
  mask: number;
  total: bigint;
  score: bigint;
}

interface BoundedSelection {
  firstMask: number;
  secondMask: number;
  total: bigint;
  score: bigint;
}

interface BoundedSelectionSearch<T> {
  firstHalf: readonly T[];
  secondHalf: readonly T[];
  firstByCount: readonly PartialSelection[][];
  secondByCount: ReadonlyArray<Array<{ total: bigint; selection: PartialSelection }>>;
}

export function selectReadyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  options: {
    minCount?: number;
    maxCount?: number;
    score?: (deposit: T) => bigint;
  } = {},
): T[] {
  const { minCount = 1, maxCount = MAX_WITHDRAWAL_REQUESTS, score } = options;
  const requiredCount = Math.max(1, minCount);
  if (
    maxAmount <= 0n ||
    maxCount <= 0 ||
    requiredCount > maxCount ||
    deposits.length === 0
  ) {
    return [];
  }

  const bestFit = selectBoundedReadyDepositSubset(deposits, maxAmount, {
    candidateLimit: BEST_FIT_SEARCH_CANDIDATES,
    minCount: requiredCount,
    maxCount,
    ...(score === undefined ? {} : { score }),
  });
  const greedy = selectGreedyDeposits(deposits, {
    maxAmount,
    maxCount,
    minCount: requiredCount,
    score,
  });

  return pickBetterSelection(deposits, bestFit, greedy, score);
}

export function selectReadyDepositsForExactCounts<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  counts: readonly number[],
  score?: (deposit: T) => bigint,
): ReadonlyMap<number, T[]> {
  return prepareReadyDepositExactCountSelector(
    deposits,
    maxAmount,
    counts,
    score,
  )(deposits);
}

export function prepareReadyDepositExactCountSelector<T extends { udtValue: bigint }>(
  boundedDeposits: readonly T[],
  maxAmount: bigint,
  counts: readonly number[],
  score?: (deposit: T) => bigint,
): (deposits: readonly T[]) => ReadonlyMap<number, T[]> {
  const positiveCounts = counts.filter((count) => count > 0);
  const bestFitByCount = new Map<number, T[]>();
  if (maxAmount > 0n && boundedDeposits.length > 0 && positiveCounts.length > 0) {
    const scoreOf = score ?? ((deposit: T): bigint => deposit.udtValue);
    const search = prepareBoundedSelectionSearch(
      boundedDeposits,
      BEST_FIT_SEARCH_CANDIDATES,
      scoreOf,
    );
    const boundedCount = search.firstHalf.length + search.secondHalf.length;
    for (const count of positiveCounts) {
      bestFitByCount.set(
        count,
        count > boundedCount
          ? []
          : selectBoundedSelection(search, maxAmount, count, count),
      );
    }
  }

  return (deposits) => {
    const selections = new Map<number, T[]>();
    for (const count of positiveCounts) {
      const bestFit = bestFitByCount.get(count) ?? [];
      const greedy =
        maxAmount <= 0n
          ? []
          : selectGreedyDeposits(deposits, {
              maxAmount,
              maxCount: count,
              minCount: count,
              score,
            });
      selections.set(count, pickBetterSelection(deposits, bestFit, greedy, score));
    }
    return selections;
  };
}

function selectBoundedReadyDepositSubset<T extends { udtValue: bigint }>(
  items: readonly T[],
  maxAmount: bigint,
  options: {
    candidateLimit: number;
    minCount: number;
    maxCount: number;
    score?: (item: T) => bigint;
  },
): T[] {
  const { candidateLimit, minCount, maxCount } = options;
  const scoreOf = options.score ?? ((item: T): bigint => item.udtValue);
  const boundedItems = items.slice(0, candidateLimit);
  const effectiveMaxCount = Math.min(maxCount, boundedItems.length);
  if (
    maxAmount <= 0n ||
    minCount < 0 ||
    effectiveMaxCount < minCount ||
    boundedItems.length === 0
  ) {
    return [];
  }

  const search = prepareBoundedSelectionSearch(
    boundedItems,
    boundedItems.length,
    scoreOf,
  );
  return selectBoundedSelection(search, maxAmount, minCount, effectiveMaxCount);
}

function prepareBoundedSelectionSearch<T extends { udtValue: bigint }>(
  items: readonly T[],
  candidateLimit: number,
  scoreOf: (item: T) => bigint,
): BoundedSelectionSearch<T> {
  const boundedItems = items.slice(0, candidateLimit);
  const split = Math.floor(boundedItems.length / 2);
  const firstHalf = boundedItems.slice(0, split);
  const secondHalf = boundedItems.slice(split);
  return {
    firstHalf,
    secondHalf,
    firstByCount: enumeratePartialSelections(firstHalf, scoreOf),
    secondByCount: enumeratePartialSelections(secondHalf, scoreOf).map((selections) =>
      prepareSelections(selections, secondHalf.length),
    ),
  };
}

function selectBoundedSelection<T>(
  search: BoundedSelectionSearch<T>,
  maxAmount: bigint,
  minCount: number,
  effectiveMaxCount: number,
): T[] {
  const best = findBestBoundedSelection({
    maxAmount,
    minCount,
    effectiveMaxCount,
    firstByCount: search.firstByCount,
    secondByCount: search.secondByCount,
    firstLength: search.firstHalf.length,
    secondLength: search.secondHalf.length,
  });

  return best === undefined
    ? []
    : selectByMasks(search.firstHalf, best.firstMask).concat(
        selectByMasks(search.secondHalf, best.secondMask),
      );
}

function enumeratePartialSelections<T extends { udtValue: bigint }>(
  items: readonly T[],
  scoreOf: (item: T) => bigint,
): PartialSelection[][] {
  const groups = Array.from({ length: items.length + 1 }, (): PartialSelection[] => []);
  const search = (index: number, partial: PartialSelection & { count: number }): void => {
    if (index === items.length) {
      const { count, ...selection } = partial;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- count ranges from 0 to items.length.
      groups[count]!.push(selection);
      return;
    }

    search(index + 1, partial);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is checked against items.length above.
    const item = items[index]!;
    search(index + 1, {
      mask: partial.mask | (1 << index),
      count: partial.count + 1,
      total: partial.total + item.udtValue,
      score: partial.score + scoreOf(item),
    });
  };

  search(0, { mask: 0, count: 0, total: 0n, score: 0n });
  return groups;
}

function findBestBoundedSelection(options: {
  maxAmount: bigint;
  minCount: number;
  effectiveMaxCount: number;
  firstByCount: readonly PartialSelection[][];
  secondByCount: ReadonlyArray<Array<{ total: bigint; selection: PartialSelection }>>;
  firstLength: number;
  secondLength: number;
}): BoundedSelection | undefined {
  let best: BoundedSelection | undefined;
  for (let firstCount = 0; firstCount <= options.effectiveMaxCount; firstCount += 1) {
    for (const first of options.firstByCount[firstCount] ?? []) {
      const candidate = bestBoundedCandidateForFirst(first, firstCount, options);
      if (
        candidate !== undefined &&
        (best === undefined ||
          isBetterSelection(candidate, best, options.firstLength, options.secondLength))
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function bestBoundedCandidateForFirst(
  first: PartialSelection,
  firstCount: number,
  options: {
    maxAmount: bigint;
    minCount: number;
    effectiveMaxCount: number;
    secondByCount: ReadonlyArray<Array<{ total: bigint; selection: PartialSelection }>>;
    firstLength: number;
    secondLength: number;
  },
): BoundedSelection | undefined {
  if (first.total > options.maxAmount) {
    return undefined;
  }

  let best: BoundedSelection | undefined;
  const minSecondCount = Math.max(0, options.minCount - firstCount);
  const maxSecondCount = options.effectiveMaxCount - firstCount;
  for (
    let secondCount = minSecondCount;
    secondCount <= maxSecondCount;
    secondCount += 1
  ) {
    const secondSelections = options.secondByCount[secondCount] ?? [];
    const second = findBestAtOrBelow(secondSelections, options.maxAmount - first.total);
    if (second === undefined) {
      continue;
    }

    const candidate = {
      firstMask: first.mask,
      secondMask: second.mask,
      total: first.total + second.total,
      score: first.score + second.score,
    };
    if (
      best === undefined ||
      isBetterSelection(candidate, best, options.firstLength, options.secondLength)
    ) {
      best = candidate;
    }
  }
  return best;
}
