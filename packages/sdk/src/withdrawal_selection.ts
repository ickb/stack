import { ccc } from "@ckb-ccc/core";
import { type IckbDepositCell } from "@ickb/core";
import { compareBigInt, selectBoundedUdtSubset } from "@ickb/utils";

const READY_POOL_BUCKET_SPAN_MS = 15n * 60n * 1000n;
const NEAR_READY_LOOKAHEAD_MS = 60n * 60n * 1000n;
const NEAR_READY_BUCKET_LOOKAHEAD = NEAR_READY_LOOKAHEAD_MS / READY_POOL_BUCKET_SPAN_MS;
const BEST_FIT_SEARCH_CANDIDATES = 30;
const DEFAULT_MAX_WITHDRAWAL_REQUESTS = 30;

export interface ReadyWithdrawalSelection {
  deposits: IckbDepositCell[];
  requiredLiveDeposits: IckbDepositCell[];
}

export interface ReadyWithdrawalCleanupSelection {
  deposit: IckbDepositCell;
  requiredLiveDeposit: IckbDepositCell;
}

export interface ReadyWithdrawalSelectionOptions {
  readyDeposits: readonly IckbDepositCell[];
  nearReadyDeposits?: readonly IckbDepositCell[];
  tip: ccc.ClientBlockHeader;
  maxAmount: bigint;
  minCount?: number;
  maxCount?: number;
  preserveSingletons?: boolean;
}

export interface ReadyWithdrawalCleanupSelectionOptions {
  readyDeposits: readonly IckbDepositCell[];
  tip: ccc.ClientBlockHeader;
  minAmountExclusive?: bigint;
  maxAmount?: bigint;
}

type ScoredReadyWithdrawalSelectionOptions = ReadyWithdrawalSelectionOptions & {
  score?: (deposit: IckbDepositCell) => bigint;
};

type ExactReadyWithdrawalSelectionOptions = Omit<
  ReadyWithdrawalSelectionOptions,
  "minCount" | "maxCount"
> & {
  count: number;
};

type ScoredExactReadyWithdrawalSelectionOptions = ExactReadyWithdrawalSelectionOptions & {
  score?: (deposit: IckbDepositCell) => bigint;
};

export function selectReadyWithdrawalDeposits(
  options: ReadyWithdrawalSelectionOptions,
): ReadyWithdrawalSelection {
  return selectReadyWithdrawalDepositsWithScore(options);
}

function selectReadyWithdrawalDepositsWithScore(
  options: ScoredReadyWithdrawalSelectionOptions,
): ReadyWithdrawalSelection {
  const {
    tip,
    maxAmount,
    readyDeposits,
    nearReadyDeposits = [],
    minCount = 1,
    maxCount = DEFAULT_MAX_WITHDRAWAL_REQUESTS,
    preserveSingletons = true,
    score,
  } = options;
  const requiredCount = Math.max(1, minCount);
  if (
    maxAmount <= 0n ||
    maxCount <= 0 ||
    requiredCount > maxCount ||
    readyDeposits.length === 0
  ) {
    return { deposits: [], requiredLiveDeposits: [] };
  }

  const { extras, singletons, anchorsByExtra } = classifyReadyDeposits(
    readyDeposits,
    nearReadyDeposits,
    tip,
  );
  const selectedExtras = selectReadyDeposits(extras, maxAmount, {
    maxCount,
    minCount: preserveSingletons ? requiredCount : 1,
    score,
  });
  if (selectedExtras.length > 0) {
    if (preserveSingletons) {
      return selectionWithRequiredAnchors(selectedExtras, anchorsByExtra);
    }

    const remainingAmount = maxAmount - sumUdtValue(selectedExtras);
    const remainingCount = maxCount - selectedExtras.length;
    const remainingRequiredCount = Math.max(1, requiredCount - selectedExtras.length);
    const selectedSingletons = selectReadyDeposits(
      singletons,
      remainingAmount,
      {
        maxCount: remainingCount,
        minCount: remainingRequiredCount,
        score,
      },
    );
    if (selectedSingletons.length === 0 && selectedExtras.length >= requiredCount) {
      return selectionWithRequiredAnchors(selectedExtras, anchorsByExtra);
    }

    const selected = new Set<IckbDepositCell>([
      ...selectedExtras,
      ...selectedSingletons,
    ]);
    const selectedDeposits = sortByMaturity(readyDeposits, tip).filter((deposit) =>
      selected.has(deposit)
    );
    if (selectedDeposits.length >= requiredCount) {
      return selectionWithRequiredAnchors(selectedDeposits, anchorsByExtra);
    }
  }

  if (preserveSingletons) {
    return { deposits: [], requiredLiveDeposits: [] };
  }

  const selectedSingletons = selectReadyDeposits(singletons, maxAmount, {
    maxCount,
    minCount: requiredCount,
    score,
  });
  if (selectedSingletons.length > 0) {
    return { deposits: selectedSingletons, requiredLiveDeposits: [] };
  }

  return selectionWithRequiredAnchors(
    selectReadyDeposits(sortByMaturity(readyDeposits, tip), maxAmount, {
      maxCount,
      minCount: requiredCount,
      score,
    }),
    anchorsByExtra,
  );
}

export function selectExactReadyWithdrawalDeposits(
  options: ExactReadyWithdrawalSelectionOptions,
): ReadyWithdrawalSelection | undefined {
  return selectExactReadyWithdrawalDepositsWithScore(options);
}

function selectExactReadyWithdrawalDepositsWithScore(
  options: ScoredExactReadyWithdrawalSelectionOptions,
): ReadyWithdrawalSelection | undefined {
  const { count, ...selectionOptions } = options;
  const selection = selectReadyWithdrawalDepositsWithScore({
    ...selectionOptions,
    minCount: count,
    maxCount: count,
  });

  return selection.deposits.length === count ? selection : undefined;
}

export function selectExactReadyWithdrawalDepositCandidates(
  options: ExactReadyWithdrawalSelectionOptions & {
    score: (deposit: IckbDepositCell) => bigint;
    maturityBucket: (deposit: IckbDepositCell) => bigint;
  },
): ReadyWithdrawalSelection[] {
  const selections: ReadyWithdrawalSelection[] = [];
  const seen = new Set<string>();
  const indexByDeposit = new Map(
    options.readyDeposits.map((deposit, index) => [deposit, index] as const),
  );
  const addSelection = (selection: ReadyWithdrawalSelection | undefined): void => {
    if (selection === undefined) {
      return;
    }

    const key = selectionKey(selection.deposits, indexByDeposit);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    selections.push(selection);
  };

  for (const bucket of uniqueBuckets(options.readyDeposits, options.maturityBucket)) {
    const readyDeposits = options.readyDeposits.filter(
      (deposit) => options.maturityBucket(deposit) <= bucket,
    );
    const baseOptions = {
      readyDeposits,
      tip: options.tip,
      maxAmount: options.maxAmount,
      count: options.count,
      preserveSingletons: options.preserveSingletons,
    };
    addSelection(selectExactReadyWithdrawalDepositsWithScore({
      ...baseOptions,
      score: options.score,
    }));
    addSelection(selectExactReadyWithdrawalDepositsWithScore(baseOptions));
  }

  return selections;
}

export function selectReadyWithdrawalCleanupDeposit(
  options: ReadyWithdrawalCleanupSelectionOptions,
): ReadyWithdrawalCleanupSelection | undefined {
  const {
    readyDeposits,
    tip,
    minAmountExclusive = 0n,
    maxAmount,
  } = options;
  if (readyDeposits.length === 0 || maxAmount !== undefined && maxAmount <= 0n) {
    return undefined;
  }

  const { readyExtras } = classifyReadyDeposits(readyDeposits, [], tip);
  const cleanup = readyExtras.find(
    ({ deposit }) =>
      deposit.udtValue > minAmountExclusive &&
      (maxAmount === undefined || deposit.udtValue <= maxAmount),
  );

  return cleanup === undefined
    ? undefined
    : { deposit: cleanup.deposit, requiredLiveDeposit: cleanup.anchor };
}

function selectReadyDeposits<T extends { udtValue: bigint }>(
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

  const bestFit = selectBoundedUdtSubset(deposits, maxAmount, {
    candidateLimit: BEST_FIT_SEARCH_CANDIDATES,
    minCount: requiredCount,
    maxCount,
    ...(score ? { score } : {}),
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

function classifyReadyDeposits(
  readyDeposits: readonly IckbDepositCell[],
  nearReadyDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): {
  extras: IckbDepositCell[];
  singletons: IckbDepositCell[];
  anchorsByExtra: Map<IckbDepositCell, IckbDepositCell>;
  readyExtras: ReadyExtra[];
} {
  const readyBuckets = new Map<bigint, IckbDepositCell[]>();
  const nearReadyBucketValues = new Map<bigint, bigint>();

  for (const deposit of sortByMaturity(readyDeposits, tip)) {
    const key = deposit.maturity.toUnix(tip) / READY_POOL_BUCKET_SPAN_MS;
    const bucket = readyBuckets.get(key);
    if (bucket) {
      bucket.push(deposit);
      continue;
    }
    readyBuckets.set(key, [deposit]);
  }

  for (const deposit of sortByMaturity(nearReadyDeposits, tip)) {
    const key = deposit.maturity.toUnix(tip) / READY_POOL_BUCKET_SPAN_MS;
    nearReadyBucketValues.set(
      key,
      (nearReadyBucketValues.get(key) ?? 0n) + deposit.udtValue,
    );
  }

  const crowdedBuckets: ReadyBucket[] = [];
  const singletonBuckets: ReadyBucket[] = [];
  for (const [key, deposits] of readyBuckets) {
    const protectedDeposit = selectProtectedBucketDeposit(deposits);
    const totalValue = sumUdtValue(deposits);
    const bucket = {
      key,
      deposits,
      protectedDeposit,
      extraValue: totalValue - protectedDeposit.udtValue,
      futureRefillValue: futureRefillValueForBucket(key, nearReadyBucketValues),
    } satisfies ReadyBucket;

    if (deposits.length === 1) {
      singletonBuckets.push(bucket);
    } else {
      crowdedBuckets.push(bucket);
    }
  }

  crowdedBuckets.sort(compareCrowdedBuckets);
  singletonBuckets.sort(compareSingletonBuckets);

  const readyExtras = crowdedBuckets.flatMap((bucket) =>
    bucket.deposits
      .filter((deposit) => deposit !== bucket.protectedDeposit)
      .map((deposit) => ({ deposit, anchor: bucket.protectedDeposit }))
  );

  return {
    extras: readyExtras.map(({ deposit }) => deposit),
    singletons: singletonBuckets.flatMap((bucket) => bucket.deposits),
    anchorsByExtra: new Map(readyExtras.map(({ deposit, anchor }) => [deposit, anchor])),
    readyExtras,
  };
}

function selectProtectedBucketDeposit(
  deposits: readonly IckbDepositCell[],
): IckbDepositCell {
  let protectedDeposit = deposits[0];
  if (!protectedDeposit) {
    throw new Error("Expected at least one deposit in bucket");
  }

  for (let index = 1; index < deposits.length; index += 1) {
    const deposit = deposits[index];
    if (!deposit) {
      throw new Error("Expected bucket deposit to exist");
    }
    if (deposit.udtValue >= protectedDeposit.udtValue) {
      protectedDeposit = deposit;
    }
  }

  return protectedDeposit;
}

function selectionWithRequiredAnchors(
  deposits: IckbDepositCell[],
  anchorsByExtra: ReadonlyMap<IckbDepositCell, IckbDepositCell>,
): ReadyWithdrawalSelection {
  const requiredLiveDeposits: IckbDepositCell[] = [];
  const seen = new Set<IckbDepositCell>(deposits);
  for (const deposit of deposits) {
    const anchor = anchorsByExtra.get(deposit);
    if (!anchor || seen.has(anchor)) {
      continue;
    }
    seen.add(anchor);
    requiredLiveDeposits.push(anchor);
  }

  return { deposits, requiredLiveDeposits };
}

function selectGreedyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  maxCount: number,
  minCount: number,
  score?: (deposit: T) => bigint,
): T[] {
  const selected: T[] = [];
  const candidates = score
    ? [...deposits].sort((left, right) => compareBigInt(score(right), score(left)))
    : deposits;
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

function pickBetterSelection<T extends { udtValue: bigint }>(
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

  if (score) {
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

function sumScore<T>(deposits: readonly T[], score: (deposit: T) => bigint): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += score(deposit);
  }
  return total;
}

function uniqueBuckets<T>(items: readonly T[], bucket: (item: T) => bigint): bigint[] {
  return [...new Set(items.map(bucket))].sort(compareBigInt);
}

function selectionKey<T>(items: readonly T[], indexByItem: ReadonlyMap<T, number>): string {
  return items
    .map((item) => String(indexByItem.get(item)))
    .sort()
    .join(",");
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
    if (inLeft === inRight) {
      continue;
    }

    return inLeft ? -1 : 1;
  }

  return 0;
}

function futureRefillValueForBucket(
  bucketKey: bigint,
  nearReadyBucketValues: ReadonlyMap<bigint, bigint>,
): bigint {
  let total = 0n;
  for (let offset = 1n; offset <= NEAR_READY_BUCKET_LOOKAHEAD; offset += 1n) {
    total += nearReadyBucketValues.get(bucketKey + offset) ?? 0n;
  }
  return total;
}

function sortByMaturity<T extends IckbDepositCell>(
  deposits: readonly T[],
  tip: ccc.ClientBlockHeader,
): T[] {
  return [...deposits].sort((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip))
  );
}

function sumUdtValue(deposits: readonly { udtValue: bigint }[]): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += deposit.udtValue;
  }
  return total;
}

function compareCrowdedBuckets(left: ReadyBucket, right: ReadyBucket): number {
  const extraCompare = compareBigInt(right.extraValue, left.extraValue);
  if (extraCompare !== 0) {
    return extraCompare;
  }

  const refillCompare = compareBigInt(
    right.futureRefillValue,
    left.futureRefillValue,
  );
  if (refillCompare !== 0) {
    return refillCompare;
  }

  return compareBigInt(left.key, right.key);
}

function compareSingletonBuckets(left: ReadyBucket, right: ReadyBucket): number {
  const refillCompare = compareBigInt(
    right.futureRefillValue,
    left.futureRefillValue,
  );
  if (refillCompare !== 0) {
    return refillCompare;
  }

  return compareBigInt(left.key, right.key);
}

interface ReadyBucket {
  key: bigint;
  deposits: IckbDepositCell[];
  protectedDeposit: IckbDepositCell;
  extraValue: bigint;
  futureRefillValue: bigint;
}

interface ReadyExtra {
  deposit: IckbDepositCell;
  anchor: IckbDepositCell;
}
