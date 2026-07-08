import { compareBigInt } from "@ickb/utils";

export function prepareSelections(
  selections: Array<{ mask: number; total: bigint; score: bigint }>,
  length: number,
): Array<{
  total: bigint;
  selection: { mask: number; total: bigint; score: bigint };
}> {
  selections.sort((left, right) => {
    const totalCompare = compareBigInt(left.total, right.total);
    return totalCompare === 0 ? compareMask(left.mask, right.mask, length) : totalCompare;
  });

  const prepared: Array<{
    total: bigint;
    selection: { mask: number; total: bigint; score: bigint };
  }> = [];
  let best: { mask: number; total: bigint; score: bigint } | undefined;
  for (const selection of selections) {
    if (best === undefined || isBetterPartialSelection(selection, best, length)) {
      best = selection;
    }
    prepared.push({ total: selection.total, selection: best });
  }

  return prepared;
}

export function findBestAtOrBelow(
  items: ReadonlyArray<{
    total: bigint;
    selection: { mask: number; total: bigint; score: bigint };
  }>,
  limit: bigint,
): { mask: number; total: bigint; score: bigint } | undefined {
  let low = 0;
  let high = items.length - 1;
  let best: { mask: number; total: bigint; score: bigint } | undefined;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- mid is inside the current binary-search bounds.
    const item = items[mid]!;

    if (item.total <= limit) {
      best = item.selection;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

export function isBetterSelection(
  left: { firstMask: number; secondMask: number; total: bigint; score: bigint },
  right: {
    firstMask: number;
    secondMask: number;
    total: bigint;
    score: bigint;
  },
  firstLength: number,
  secondLength: number,
): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }

  if (left.total !== right.total) {
    return left.total > right.total;
  }

  const firstCompare = compareMask(left.firstMask, right.firstMask, firstLength);
  return (
    firstCompare < 0 ||
    (firstCompare === 0 &&
      compareMask(left.secondMask, right.secondMask, secondLength) < 0)
  );
}

export function selectByMasks<T>(items: readonly T[], mask: number): T[] {
  const selected: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if ((mask & (1 << i)) !== 0) {
      const item = items[i];
      if (item !== undefined) {
        selected.push(item);
      }
    }
  }
  return selected;
}

export function pickBetterSelection<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  left: T[],
  right: T[],
  score?: (deposit: T) => bigint,
): T[] {
  if (left.length === 0) {
    return right;
  }

  if (right.length === 0) {
    return left;
  }

  if (score !== undefined) {
    const leftScore = sumScore(left, score);
    const rightScore = sumScore(right, score);
    if (leftScore > rightScore) {
      return left;
    }

    if (rightScore > leftScore) {
      return right;
    }
  }

  const leftTotal = sumUdtValue(left);
  const rightTotal = sumUdtValue(right);
  if (leftTotal > rightTotal) {
    return left;
  }

  if (rightTotal > leftTotal) {
    return right;
  }

  return compareSelectionOrder(deposits, left, right) <= 0 ? left : right;
}

export function selectGreedyDeposits<T extends { udtValue: bigint }>(
  ...[deposits, maxAmount, maxCount, minCount, score]: [
    deposits: readonly T[],
    maxAmount: bigint,
    maxCount: number,
    minCount: number,
    score?: (deposit: T) => bigint,
  ]
): T[] {
  const selected: T[] = [];
  const candidates =
    score === undefined
      ? deposits
      : deposits.toSorted((left, right) => compareBigInt(score(right), score(left)));
  let cumulative = 0n;
  for (const deposit of candidates) {
    if (selected.length >= maxCount) {
      break;
    }
    if (cumulative + deposit.udtValue > maxAmount) {
      continue;
    }
    cumulative += deposit.udtValue;
    selected.push(deposit);
  }

  return selected.length >= minCount ? selected : [];
}

function isBetterPartialSelection(
  left: { mask: number; total: bigint; score: bigint },
  right: { mask: number; total: bigint; score: bigint },
  length: number,
): boolean {
  if (left.score !== right.score) {
    return left.score > right.score;
  }
  if (left.total !== right.total) {
    return left.total > right.total;
  }
  return compareMask(left.mask, right.mask, length) < 0;
}

function compareMask(left: number, right: number, length: number): number {
  for (let i = 0; i < length; i += 1) {
    const leftHas = (left & (1 << i)) !== 0;
    const rightHas = (right & (1 << i)) !== 0;
    if (leftHas !== rightHas) {
      return leftHas ? -1 : 1;
    }
  }
  return 0;
}

function sumScore<T>(deposits: readonly T[], score: (deposit: T) => bigint): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += score(deposit);
  }
  return total;
}

function sumUdtValue(deposits: ReadonlyArray<{ udtValue: bigint }>): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += deposit.udtValue;
  }
  return total;
}

function compareSelectionOrder<T>(
  deposits: readonly T[],
  left: readonly T[],
  right: readonly T[],
): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  for (const deposit of deposits) {
    const inLeft = leftSet.has(deposit);
    const inRight = rightSet.has(deposit);
    if (inLeft !== inRight) {
      return inLeft ? -1 : 1;
    }
  }
  return 0;
}
