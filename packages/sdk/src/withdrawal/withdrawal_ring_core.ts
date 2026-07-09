import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import type { WithdrawalDepositCandidate } from "./withdrawal_selection_types.ts";

const RING_EPOCHS = 180n;

/**
 * Ring segment of pool deposits grouped by maturity around the DAO cycle.
 *
 * @public
 */
export interface RingSegment<T extends WithdrawalDepositCandidate = IckbDepositCell> {
  /** Segment index in the ring. */
  index: number;

  /** Deposits assigned to this segment. */
  deposits: T[];

  /** Total iCKB value of deposits in this segment. */
  udtValue: bigint;
}

/**
 * Returns the segment index containing the sampled tip epoch.
 *
 * @public
 */
export function ringTargetSegmentIndex(
  tip: ccc.ClientBlockHeader,
  segmentCount: number,
): number {
  return ringSegmentIndex(tip.epoch, segmentCount);
}

/**
 * Splits pool deposits into power-of-two maturity ring segments.
 *
 * @public
 */
export function ringSegments<T extends WithdrawalDepositCandidate = IckbDepositCell>(
  poolDeposits: readonly T[],
): Array<RingSegment<T>> {
  const segmentCount = nextPowerOfTwo(poolDeposits.length);
  const segments = Array.from({ length: segmentCount }, (_, index): RingSegment<T> => ({
    index,
    deposits: [],
    udtValue: 0n,
  }));

  for (const deposit of poolDeposits) {
    const segmentIndex = ringSegmentIndex(deposit.maturity, segmentCount);
    const segment = segments[segmentIndex];
    if (segment === undefined) {
      throw new Error(`Missing withdrawal ring segment at index ${String(segmentIndex)}`);
    }
    segment.deposits.push(deposit);
    segment.udtValue += deposit.udtValue;
  }

  return segments;
}

/** Stable deposit identity based on its out point. */
export function depositKey(deposit: WithdrawalDepositCandidate): string {
  return deposit.cell.outPoint.toHex();
}

function ringSegmentIndex(
  epoch: WithdrawalDepositCandidate["maturity"],
  segmentCount: number,
): number {
  const { denominator } = epoch;
  if (denominator <= 0n) {
    throw new Error("Epoch denominator must be positive");
  }
  const scaled = epoch.integer * denominator + epoch.numerator;
  const ring = RING_EPOCHS * denominator;
  const wrapped = ((scaled % ring) + ring) % ring;
  return Number((wrapped * BigInt(segmentCount)) / ring);
}

function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}
