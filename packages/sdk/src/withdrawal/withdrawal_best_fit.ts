import {
  findBestAtOrBelow,
  isBetterSelection,
  pickBetterSelection,
  prepareSelections,
  selectByMasks,
  selectGreedyDeposits,
} from "./withdrawal_best_fit_support.ts";

const BEST_FIT_SEARCH_CANDIDATES = 30;
export const DEFAULT_MAX_WITHDRAWAL_REQUESTS = 30;

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

export function selectReadyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  options: {
    minCount?: number;
    maxCount?: number;
    score?: (deposit: T) => bigint;
  } = {},
): T[] {
  const { minCount = 1, maxCount = DEFAULT_MAX_WITHDRAWAL_REQUESTS, score } = options;
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
  const greedy = selectGreedyDeposits(
    deposits,
    maxAmount,
    maxCount,
    requiredCount,
    score,
  );

  return pickBetterSelection(deposits, bestFit, greedy, score);
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

  const split = Math.floor(boundedItems.length / 2);
  const firstHalf = boundedItems.slice(0, split);
  const secondHalf = boundedItems.slice(split);
  const firstByCount = enumeratePartialSelections(firstHalf, scoreOf);
  const secondByCount = enumeratePartialSelections(secondHalf, scoreOf).map(
    (selections) => prepareSelections(selections, secondHalf.length),
  );
  const best = findBestBoundedSelection({
    maxAmount,
    minCount,
    effectiveMaxCount,
    firstByCount,
    secondByCount,
    firstLength: firstHalf.length,
    secondLength: secondHalf.length,
  });

  return best === undefined
    ? []
    : selectByMasks(firstHalf, best.firstMask).concat(
        selectByMasks(secondHalf, best.secondMask),
      );
}

function enumeratePartialSelections<T extends { udtValue: bigint }>(
  items: readonly T[],
  scoreOf: (item: T) => bigint,
): PartialSelection[][] {
  const groups = Array.from({ length: items.length + 1 }, (): PartialSelection[] => []);
  const search = (
    ...[index, mask, count, total, score]: [
      index: number,
      mask: number,
      count: number,
      total: bigint,
      score: bigint,
    ]
  ): void => {
    if (index === items.length) {
      const group = groups[count];
      if (group === undefined) {
        throw new Error(`Partial selection group ${String(count)} is missing`);
      }
      group.push({ mask, total, score });
      return;
    }

    search(index + 1, mask, count, total, score);
    const item = items[index];
    if (item === undefined) {
      throw new Error(`Withdrawal item ${String(index)} is missing`);
    }
    search(
      index + 1,
      mask | (1 << index),
      count + 1,
      total + item.udtValue,
      score + scoreOf(item),
    );
  };

  search(0, 0, 0, 0n, 0n);
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
