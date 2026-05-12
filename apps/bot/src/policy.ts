import { ccc } from "@ckb-ccc/core";
import { ICKB_DEPOSIT_CAP, type IckbDepositCell } from "@ickb/core";
import {
  selectReadyWithdrawalCleanupDeposit,
  selectReadyWithdrawalDeposits,
} from "@ickb/sdk";
import { compareBigInt } from "@ickb/utils";

export const CKB = ccc.fixedPointFrom(1);
export const CKB_RESERVE = 1000n * CKB;
export const MIN_ICKB_BALANCE = 2000n * CKB;
export const TARGET_ICKB_BALANCE = ICKB_DEPOSIT_CAP + 20000n * CKB;
export const NEAR_READY_LOOKAHEAD_MS = 60n * 60n * 1000n;

const OUTPUTS_PER_REBALANCE_ACTION = 2;
const MAX_WITHDRAWAL_REQUESTS = 30;
const SINGLETON_ANCHOR_OVERRIDE_EXCESS = ICKB_DEPOSIT_CAP;
const FRESH_DEPOSIT_TARGET_EPOCH_OFFSET: [bigint, bigint, bigint] = [180n, 0n, 1n];
const FUTURE_SEGMENT_UNDERCOVERAGE_RATIO_DENOMINATOR = 2n;

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
      requiredLiveDeposits: [cleanup.requiredLiveDeposit],
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

  return selectReadyWithdrawalDeposits({
    readyDeposits,
    nearReadyDeposits,
    tip,
    maxAmount,
    maxCount: limit,
    preserveSingletons: !canSpendSingletonAnchors(maxAmount),
  });
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
): ReturnType<typeof selectReadyWithdrawalCleanupDeposit> {
  return selectReadyWithdrawalCleanupDeposit({
    readyDeposits,
    tip,
    minAmountExclusive: ICKB_DEPOSIT_CAP,
    maxAmount: ickbBalance - TARGET_ICKB_BALANCE,
  });
}

function canSpendSingletonAnchors(excessIckb: bigint): boolean {
  return excessIckb >= SINGLETON_ANCHOR_OVERRIDE_EXCESS;
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

function compareDepositsByMaturity(tip: ccc.ClientBlockHeader) {
  return (left: IckbDepositCell, right: IckbDepositCell): number =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip));
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
