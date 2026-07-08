import type { IckbDepositCell } from "@ickb/core";
import { ringAnchorDeposits, ringSegmentAnchor } from "./withdrawal_ring_anchor.ts";
import {
  depositKey,
  ringSegments,
  ringTargetSegmentIndex,
} from "./withdrawal_ring_core.ts";
import type { WithdrawalDepositCandidate } from "./withdrawal_selection_types.ts";

export type { RingSegment } from "./withdrawal_ring_core.ts";
export { depositKey, ringSegmentAnchor, ringSegments, ringTargetSegmentIndex };

/**
 * Returns a filter that excludes the ring anchor deposits from surplus selection.
 *
 * @public
 */
export function ringSurplusDepositFilter<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(poolDeposits: readonly T[]): (deposit: T) => boolean {
  const anchors = new Set(ringAnchorDeposits(poolDeposits).map(depositKey));
  return (deposit) => !anchors.has(depositKey(deposit));
}

/**
 * Returns the live anchor deposit required when withdrawing a non-anchor deposit.
 *
 * @public
 */
export function ringRequiredLiveDepositFor<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(poolDeposits: readonly T[]): (deposit: T) => T | undefined {
  const anchors = new Map<string, T>();
  for (const segment of ringSegments(poolDeposits)) {
    const anchor = ringSegmentAnchor(segment.deposits);
    if (anchor === undefined) {
      continue;
    }
    for (const deposit of segment.deposits) {
      if (depositKey(deposit) !== depositKey(anchor)) {
        anchors.set(depositKey(deposit), anchor);
      }
    }
  }
  return (deposit) => anchors.get(depositKey(deposit));
}
