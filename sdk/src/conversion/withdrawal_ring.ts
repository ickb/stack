import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../logic.ts";
import { compareBigInt } from "../utils/utils.ts";

const RING_EPOCHS = 180n;

/**
 * Ring segment of pool deposits grouped by maturity around the DAO cycle.
 */
export interface RingSegment {
  /** Segment index in the ring. */
  index: number;

  /** Deposits assigned to this segment. */
  deposits: IckbDepositCell[];

  /** Total iCKB value of deposits in this segment. */
  udtValue: bigint;
}

/**
 * Splits pool deposits into power-of-two maturity ring segments.
 */
export function ringSegments(poolDeposits: readonly IckbDepositCell[]): RingSegment[] {
  const segmentCount = nextPowerOfTwo(poolDeposits.length);
  const segments = Array.from({ length: segmentCount }, (_, index): RingSegment => ({
    index,
    deposits: [],
    udtValue: 0n,
  }));

  for (const deposit of poolDeposits) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringSegmentIndex returns 0 <= index < segmentCount.
    const segment = segments[ringSegmentIndex(deposit.maturity, segmentCount)]!;
    segment.deposits.push(deposit);
    segment.udtValue += deposit.udtValue;
  }

  return segments;
}

/** The segment index an epoch falls in, for a deposit's maturity or the tip. */
export function ringSegmentIndex(epoch: ccc.Epoch, segmentCount: number): number {
  const { denominator } = epoch;
  if (denominator <= 0n) {
    throw new Error("Epoch denominator must be positive");
  }
  const scaled = epoch.integer * denominator + epoch.numerator;
  const ring = RING_EPOCHS * denominator;
  const wrapped = ((scaled % ring) + ring) % ring;
  return Number((wrapped * BigInt(segmentCount)) / ring);
}

/**
 * Returns a filter that excludes the ring anchor deposits from surplus selection: each
 * segment keeps its anchor, the largest not-ready deposit, else the largest one.
 */
export function ringSurplusDepositFilter(
  poolDeposits: readonly IckbDepositCell[],
): (deposit: IckbDepositCell) => boolean {
  const anchors = new Set(
    ringSegments(poolDeposits).flatMap((segment) => {
      const anchor = segment.deposits.reduce<IckbDepositCell | undefined>(
        (best, deposit) =>
          best === undefined || isBetterRingAnchor(deposit, best) ? deposit : best,
        undefined,
      );
      return anchor === undefined ? [] : [anchor.cell.outPoint.toHex()];
    }),
  );
  return (deposit) => !anchors.has(deposit.cell.outPoint.toHex());
}

function isBetterRingAnchor(
  candidate: IckbDepositCell,
  current: IckbDepositCell,
): boolean {
  if (candidate.isReady !== current.isReady) {
    return !candidate.isReady;
  }
  return candidate.udtValue > current.udtValue;
}

/**
 * Selects ready deposits for withdrawal requests greedily by maturity.
 *
 * @remarks
 * The deposit closest to its cycle boundary turns into CKB soonest, which is the wait the
 * user feels, so candidates are walked from the earliest maturity and each one that still
 * fits under `maxAmount` is taken (decisions amendment 40). How many of the selected
 * deposits one transaction can carry is decided later by completion, not here.
 */
export function selectReadyWithdrawalDeposits(
  readyDeposits: readonly IckbDepositCell[],
  maxAmount: bigint,
  tip: ccc.ClientBlockHeader,
): IckbDepositCell[] {
  const deposits: IckbDepositCell[] = [];
  let total = 0n;
  for (const deposit of sortByMaturity(readyDeposits, tip)) {
    if (total + deposit.udtValue > maxAmount) {
      continue;
    }
    total += deposit.udtValue;
    deposits.push(deposit);
  }
  return deposits;
}

/** Earliest maturity first: the deposit that turns into CKB soonest. */
export function sortByMaturity(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): IckbDepositCell[] {
  return deposits.toSorted((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
  );
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}
