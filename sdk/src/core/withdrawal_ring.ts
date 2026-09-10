import type { IckbDepositCell } from "./cells.ts";
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
