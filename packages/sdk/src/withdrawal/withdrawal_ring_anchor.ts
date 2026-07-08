import type { IckbDepositCell } from "@ickb/core";
import { ringSegments } from "./withdrawal_ring_core.ts";
import type { WithdrawalDepositCandidate } from "./withdrawal_selection_types.ts";

/**
 * Returns the selected anchor deposit for each withdrawal ring segment.
 *
 * @public
 */
export function ringAnchorDeposits<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(poolDeposits: readonly T[]): T[] {
  return ringSegments(poolDeposits)
    .map((segment) => ringSegmentAnchor(segment.deposits))
    .filter((deposit): deposit is T => deposit !== undefined);
}

/**
 * Selects the live anchor deposit for one withdrawal ring segment.
 *
 * @public
 */
export function ringSegmentAnchor<T extends WithdrawalDepositCandidate>(
  deposits: readonly T[],
): T | undefined {
  let anchor: T | undefined;
  for (const deposit of deposits) {
    if (anchor === undefined || isBetterRingAnchor(deposit, anchor)) {
      anchor = deposit;
    }
  }
  return anchor;
}

function isBetterRingAnchor<T extends WithdrawalDepositCandidate>(
  candidate: T,
  current: T,
): boolean {
  if (candidate.isReady !== current.isReady) {
    return !candidate.isReady;
  }
  return candidate.udtValue > current.udtValue;
}
