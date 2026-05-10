import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "@ickb/core";
import { selectBoundedUdtSubset } from "@ickb/utils";

export const CKB = ccc.fixedPointFrom(1);
export const CKB_RESERVE = 1000n * CKB;
export const MIN_ICKB_BALANCE = 2000n * CKB;
export const TARGET_ICKB_BALANCE = ICKB_DEPOSIT_CAP + 20000n * CKB;
export const NEAR_READY_LOOKAHEAD_MS = 60n * 60n * 1000n;

const OUTPUTS_PER_REBALANCE_ACTION = 2;
const READY_POOL_BUCKET_SPAN_MS = 15n * 60n * 1000n;
const BEST_FIT_SEARCH_CANDIDATES = 30;
const MAX_WITHDRAWAL_REQUESTS = 30;
const SINGLETON_ANCHOR_OVERRIDE_EXCESS = ICKB_DEPOSIT_CAP;
const FRESH_DEPOSIT_TARGET_EPOCH_OFFSET: [bigint, bigint, bigint] = [180n, 0n, 1n];
const FUTURE_SEGMENT_UNDERCOVERAGE_RATIO_DENOMINATOR = 2n;
const NEAR_READY_BUCKET_LOOKAHEAD =
  NEAR_READY_LOOKAHEAD_MS / READY_POOL_BUCKET_SPAN_MS;

export type RebalancePlan =
  | { kind: "none" }
  | { kind: "deposit"; quantity: 1 }
  | {
      kind: "withdraw";
      deposits: IckbDepositCell[];
      requiredLiveDeposits?: IckbDepositCell[];
    };

export function partitionPoolDeposits(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
  readyWindowEnd: bigint,
): {
  ready: IckbDepositCell[];
  nearReady: IckbDepositCell[];
  future: IckbDepositCell[];
} {
  const ready: IckbDepositCell[] = [];
  const nearReady: IckbDepositCell[] = [];
  const future: IckbDepositCell[] = [];
  const nearReadyCutoff = readyWindowEnd + NEAR_READY_LOOKAHEAD_MS;

  for (const deposit of deposits) {
    const maturityUnix = deposit.maturity.toUnix(tip);
    if (deposit.isReady) {
      ready.push(deposit);
      continue;
    }

    if (maturityUnix < readyWindowEnd) {
      continue;
    }

    if (maturityUnix < nearReadyCutoff) {
      nearReady.push(deposit);
      continue;
    }

    future.push(deposit);
  }

  ready.sort(compareDepositsByMaturity(tip));
  nearReady.sort(compareDepositsByMaturity(tip));
  future.sort(compareDepositsByMaturity(tip));

  return { ready, nearReady, future };
}

export function planRebalance(options: {
  outputSlots: number;
  tip: ccc.ClientBlockHeader;
  ickbBalance: bigint;
  ckbBalance: bigint;
  depositCapacity: bigint;
  readyDeposits: readonly IckbDepositCell[];
  nearReadyDeposits: readonly IckbDepositCell[];
  futurePoolDeposits: readonly IckbDepositCell[];
}): RebalancePlan {
  const {
    outputSlots,
    tip,
    ickbBalance,
    ckbBalance,
    depositCapacity,
    readyDeposits,
    nearReadyDeposits,
    futurePoolDeposits,
  } =
    options;

  if (outputSlots < OUTPUTS_PER_REBALANCE_ACTION) {
    return { kind: "none" };
  }

  if (ickbBalance < MIN_ICKB_BALANCE) {
    if (ckbBalance >= depositCapacity + CKB_RESERVE) {
      return { kind: "deposit", quantity: 1 };
    }
    return { kind: "none" };
  }

  if (
    shouldSeedFutureSegment(
      futurePoolDeposits,
      tip,
      ickbBalance,
      ckbBalance,
      depositCapacity,
    )
  ) {
    return { kind: "deposit", quantity: 1 };
  }

  const excessIckb = ickbBalance - TARGET_ICKB_BALANCE;
  if (excessIckb <= 0n) {
    return { kind: "none" };
  }

  const withdrawalLimit = Math.min(
    MAX_WITHDRAWAL_REQUESTS,
    Math.floor(outputSlots / OUTPUTS_PER_REBALANCE_ACTION),
  );
  const cleanup = selectNonStandardCleanupDeposit(
    readyDeposits,
    tip,
    ickbBalance,
  );
  if (cleanup) {
    return {
      kind: "withdraw",
      deposits: [cleanup.deposit],
      requiredLiveDeposits: [cleanup.anchor],
    };
  }

  const selection = selectPoolRebalancingDeposits(
    readyDeposits,
    nearReadyDeposits,
    tip,
    excessIckb,
    withdrawalLimit,
  );
  if (selection.deposits.length > 0) {
    return {
      kind: "withdraw",
      deposits: selection.deposits,
      ...(selection.requiredLiveDeposits.length > 0
        ? { requiredLiveDeposits: selection.requiredLiveDeposits }
        : {}),
    };
  }
  return { kind: "none" };
}

function selectPoolRebalancingDeposits(
  readyDeposits: readonly IckbDepositCell[],
  nearReadyDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
  maxAmount: bigint,
  limit: number,
): {
  deposits: IckbDepositCell[];
  requiredLiveDeposits: IckbDepositCell[];
} {
  if (maxAmount <= 0n || limit <= 0 || readyDeposits.length === 0) {
    return { deposits: [], requiredLiveDeposits: [] };
  }

  const { cleanupExtras, extras, singletons, nonSingletonReady } = classifyReadyDeposits(
    readyDeposits,
    nearReadyDeposits,
    tip,
  );
  const anchorsByExtra = new Map(
    cleanupExtras.map(({ deposit, anchor }) => [deposit, anchor]),
  );
  const allowSingletonConsumption = canSpendSingletonAnchors(maxAmount);
  const selectedExtras = selectReadyDeposits(extras, maxAmount, limit);
  if (selectedExtras.length > 0) {
    const remainingAmount = maxAmount - sumUdtValue(selectedExtras);
    const remainingLimit = limit - selectedExtras.length;
    if (
      !allowSingletonConsumption ||
      remainingAmount <= 0n ||
      remainingLimit <= 0 ||
      singletons.length === 0
    ) {
      return selectionWithRequiredAnchors(selectedExtras, anchorsByExtra);
    }

    const selectedSingletons = selectReadyDeposits(
      singletons,
      remainingAmount,
      remainingLimit,
    );
    if (selectedSingletons.length === 0) {
      return selectionWithRequiredAnchors(selectedExtras, anchorsByExtra);
    }

    const selected = new Set<IckbDepositCell>([
      ...selectedExtras,
      ...selectedSingletons,
    ]);
    return selectionWithRequiredAnchors(
      readyDeposits.filter((deposit) => selected.has(deposit)),
      anchorsByExtra,
    );
  }

  if (!allowSingletonConsumption) {
    return selectionWithRequiredAnchors(
      selectReadyDeposits(nonSingletonReady, maxAmount, limit),
      anchorsByExtra,
    );
  }

  const selectedSingletons = selectReadyDeposits(singletons, maxAmount, limit);
  if (selectedSingletons.length === 0) {
    return selectionWithRequiredAnchors(
      selectReadyDeposits(readyDeposits, maxAmount, limit),
      anchorsByExtra,
    );
  }

  return { deposits: selectedSingletons, requiredLiveDeposits: [] };
}

function selectionWithRequiredAnchors(
  deposits: IckbDepositCell[],
  anchorsByExtra: ReadonlyMap<IckbDepositCell, IckbDepositCell>,
): {
  deposits: IckbDepositCell[];
  requiredLiveDeposits: IckbDepositCell[];
} {
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

function shouldSeedFutureSegment(
  futurePoolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
  ickbBalance: bigint,
  ckbBalance: bigint,
  depositCapacity: bigint,
): boolean {
  const futureDeposits = futurePoolDeposits.filter((deposit) => !deposit.isReady);

  if (!canCreateFutureInventory(ickbBalance, ckbBalance, depositCapacity)) {
    return false;
  }

  if (futureDeposits.length === 0) {
    return true;
  }

  if (futureDeposits.length === 1) {
    return false;
  }

  const futureLayout = analyzeFutureSegments(futureDeposits, tip);
  if (futureDeposits.length === 2 && !futureLayout.anchorsShareOneSegment) {
    return false;
  }

  if (futureLayout.totalFutureUdt <= 0n) {
    return false;
  }

  return isUnderCoveredFutureSegment(
    futureLayout.targetSegment.udtValue,
    futureLayout.targetSegment.length,
    futureLayout.totalFutureUdt,
    futureLayout.ringLength,
  );
}

function canCreateFutureInventory(
  ickbBalance: bigint,
  ckbBalance: bigint,
  depositCapacity: bigint,
): boolean {
  return (
    ickbBalance > MIN_ICKB_BALANCE &&
    ckbBalance >= depositCapacity + CKB_RESERVE &&
    ickbBalance + ICKB_DEPOSIT_CAP <= TARGET_ICKB_BALANCE
  );
}

function selectNonStandardCleanupDeposit(
  readyDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
  ickbBalance: bigint,
): ReadyExtra | undefined {
  const { cleanupExtras } = classifyReadyDeposits(readyDeposits, [], tip);

  return cleanupExtras.find(
    ({ deposit }) =>
      deposit.udtValue > ICKB_DEPOSIT_CAP &&
      ickbBalance - deposit.udtValue >= TARGET_ICKB_BALANCE,
  );
}

function classifyReadyDeposits(
  readyDeposits: readonly IckbDepositCell[],
  nearReadyDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): {
  extras: IckbDepositCell[];
  cleanupExtras: ReadyExtra[];
  singletons: IckbDepositCell[];
  nonSingletonReady: IckbDepositCell[];
} {
  const readyBuckets = new Map<bigint, IckbDepositCell[]>();
  const nearReadyBucketValues = new Map<bigint, bigint>();

  for (const deposit of readyDeposits) {
    const key = deposit.maturity.toUnix(tip) / READY_POOL_BUCKET_SPAN_MS;
    const bucket = readyBuckets.get(key);
    if (bucket) {
      bucket.push(deposit);
      continue;
    }
    readyBuckets.set(key, [deposit]);
  }

  for (const deposit of nearReadyDeposits) {
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

  const cleanupExtras = crowdedBuckets.flatMap((bucket) =>
    bucket.deposits
      .filter((deposit) => deposit !== bucket.protectedDeposit)
      .map((deposit) => ({ deposit, anchor: bucket.protectedDeposit }))
  );

  return {
    extras: cleanupExtras.map(({ deposit }) => deposit),
    cleanupExtras,
    singletons: singletonBuckets.flatMap((bucket) => bucket.deposits),
    nonSingletonReady: crowdedBuckets.flatMap((bucket) => bucket.deposits),
  };
}

function canSpendSingletonAnchors(excessIckb: bigint): boolean {
  return excessIckb >= SINGLETON_ANCHOR_OVERRIDE_EXCESS;
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

export function selectReadyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  limit = MAX_WITHDRAWAL_REQUESTS,
): T[] {
  if (maxAmount <= 0n || limit <= 0 || deposits.length === 0) {
    return [];
  }

  const bestFit = selectBestFitDeposits(deposits, maxAmount, limit);
  const greedy = selectGreedyDeposits(deposits, maxAmount, limit);

  return pickBetterSelection(deposits, bestFit, greedy);
}

function selectGreedyDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  limit: number,
): T[] {
  const selected: T[] = [];
  let cumulative = 0n;

  for (const deposit of deposits) {
    if (selected.length >= limit) {
      break;
    }

    if (cumulative + deposit.udtValue > maxAmount) {
      continue;
    }

    cumulative += deposit.udtValue;
    selected.push(deposit);
  }

  return selected;
}

function selectBestFitDeposits<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  maxAmount: bigint,
  limit: number,
): T[] {
  return selectBoundedUdtSubset(deposits, maxAmount, {
    candidateLimit: BEST_FIT_SEARCH_CANDIDATES,
    minCount: 1,
    maxCount: limit,
  });
}

function pickBetterSelection<T extends { udtValue: bigint }>(
  deposits: readonly T[],
  left: T[],
  right: T[],
): T[] {
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

function sumUdtValue(
  deposits: readonly { udtValue: bigint }[],
): bigint {
  let total = 0n;
  for (const deposit of deposits) {
    total += deposit.udtValue;
  }
  return total;
}

function futureRefillValueForBucket(
  bucketKey: bigint,
  nearReadyBucketValues: ReadonlyMap<bigint, bigint>,
): bigint {
  let total = 0n;
  // nearReadyDeposits only cover maturities after the current ready window, so
  // refill for one ready bucket starts in the next absolute maturity bucket.
  for (let offset = 1n; offset <= NEAR_READY_BUCKET_LOOKAHEAD; offset += 1n) {
    total += nearReadyBucketValues.get(bucketKey + offset) ?? 0n;
  }
  return total;
}

// Phase 1 future shaping keeps the current direct-deposit transaction shape,
// but it now uses the historical 180-epoch ring in the smallest honest live
// form: ringLength = tip+180 epochs - tip, origin = absolute unix 0 modulo that
// ring, Q = 2^(ceil(log2(anchorCount))) for 2+ future anchors, and wraparound =
// floor((maturityUnix mod ringLength) * Q / ringLength). Low-count base cases
// stay explicit: 0 bootstraps the first anchor, 1 preserves the lone anchor,
// and 2 only shape if both anchors crowd the same Q=2 segment.
function futureRingLengthForTip(tip: ccc.ClientBlockHeader): bigint {
  return tip.epoch.add(FRESH_DEPOSIT_TARGET_EPOCH_OFFSET).toUnix(tip) -
    tip.epoch.toUnix(tip);
}

function analyzeFutureSegments(
  futurePoolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): FutureLayout {
  const ringLength = futureRingLengthForTip(tip);
  const segmentCount = nextPowerOfTwo(futurePoolDeposits.length);
  const targetSegmentIndex = futureSegmentIndexForUnix(
    tip.epoch.add(FRESH_DEPOSIT_TARGET_EPOCH_OFFSET).toUnix(tip),
    ringLength,
    segmentCount,
  );
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    index,
    length:
      futureSegmentBoundary(index + 1, ringLength, segmentCount) -
      futureSegmentBoundary(index, ringLength, segmentCount),
    deposits: [] as IckbDepositCell[],
    udtValue: 0n,
  } satisfies FutureSegment));

  let totalFutureUdt = 0n;
  let firstSegmentIndex: number | undefined;
  let anchorsShareOneSegment = true;

  for (const deposit of futurePoolDeposits) {
    totalFutureUdt += deposit.udtValue;

    const segmentIndex = futureSegmentIndexForUnix(
      deposit.maturity.toUnix(tip),
      ringLength,
      segmentCount,
    );
    const segment = segments[segmentIndex];
    if (!segment) {
      throw new Error("Expected future segment to exist");
    }
    segment.deposits.push(deposit);
    segment.udtValue += deposit.udtValue;

    if (firstSegmentIndex === undefined) {
      firstSegmentIndex = segmentIndex;
      continue;
    }

    if (segmentIndex !== firstSegmentIndex) {
      anchorsShareOneSegment = false;
    }
  }

  const targetSegment = segments[targetSegmentIndex];
  if (!targetSegment) {
    throw new Error("Expected target future segment to exist");
  }

  return {
    ringLength,
    segmentCount,
    targetSegmentIndex,
    targetSegment,
    totalFutureUdt,
    anchorsShareOneSegment,
    segments,
  };
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

function futureSegmentBoundary(
  segmentIndex: number,
  ringLength: bigint,
  segmentCount: number,
): bigint {
  return (ringLength * BigInt(segmentIndex)) / BigInt(segmentCount);
}

function futureSegmentIndexForUnix(
  maturityUnix: bigint,
  ringLength: bigint,
  segmentCount: number,
): number {
  const wrappedMaturity = ((maturityUnix % ringLength) + ringLength) % ringLength;
  return Number((wrappedMaturity * BigInt(segmentCount)) / ringLength);
}

function isUnderCoveredFutureSegment(
  segmentUdtValue: bigint,
  segmentLength: bigint,
  totalFutureUdt: bigint,
  ringLength: bigint,
): boolean {
  return (
    FUTURE_SEGMENT_UNDERCOVERAGE_RATIO_DENOMINATOR * segmentUdtValue * ringLength <
    totalFutureUdt * segmentLength
  );
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

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareDepositsByMaturity(tip: ccc.ClientBlockHeader) {
  return (left: IckbDepositCell, right: IckbDepositCell): number =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip));
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

interface FutureLayout {
  ringLength: bigint;
  segmentCount: number;
  targetSegmentIndex: number;
  targetSegment: FutureSegment;
  totalFutureUdt: bigint;
  anchorsShareOneSegment: boolean;
  segments: FutureSegment[];
}

interface FutureSegment {
  index: number;
  length: bigint;
  deposits: IckbDepositCell[];
  udtValue: bigint;
}
