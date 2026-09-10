import type { ccc } from "@ckb-ccc/core";
import { compareBigInt } from "../utils/index.ts";
import type { IckbDepositCell } from "./cells.ts";
import { depositKey } from "./withdrawal_ring.ts";
import type {
  ReadyWithdrawalSelectionOptions,
  WithdrawalDepositCandidate,
} from "./withdrawal_selection_types.ts";

export {
  ringSegmentAnchor,
  ringSegments,
  ringSurplusDepositFilter,
  ringTargetSegmentIndex,
} from "./withdrawal_ring.ts";
export type { RingSegment } from "./withdrawal_ring.ts";
export type {
  ReadyWithdrawalSelectionOptions,
  WithdrawalDepositCandidate,
} from "./withdrawal_selection_types.ts";

/**
 * Selects ready deposits for withdrawal requests greedily by maturity.
 *
 * @remarks
 * The deposit closest to its cycle boundary turns into CKB soonest, which is the wait the
 * user feels, so candidates are walked from the earliest maturity and each one that still
 * fits under `maxAmount` is taken (decisions amendment 40). How many of the selected
 * deposits one transaction can carry is decided later by completion, not here.
 *
 * @public
 */
export function selectReadyWithdrawalDeposits<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(options: ReadyWithdrawalSelectionOptions<T>): T[] {
  assertReadyWithdrawalDeposits(options.readyDeposits);
  const {
    tip,
    maxAmount,
    readyDeposits,
    canSelectDeposit = (): boolean => true,
  } = options;
  const deposits: T[] = [];
  let total = 0n;
  for (const deposit of sortByMaturity(readyDeposits, tip)) {
    if (!canSelectDeposit(deposit) || total + deposit.udtValue > maxAmount) {
      continue;
    }
    total += deposit.udtValue;
    deposits.push(deposit);
  }
  return deposits;
}

export function assertReadyWithdrawalDeposits(
  deposits: readonly WithdrawalDepositCandidate[],
): void {
  const seen = new Set<string>();
  for (const deposit of deposits) {
    const outPoint = depositKey(deposit);
    if (!deposit.isReady) {
      throw new Error(`Withdrawal deposit ${outPoint} is not ready`);
    }
    if (seen.has(outPoint)) {
      throw new Error(`Withdrawal deposit ${outPoint} is duplicated`);
    }
    seen.add(outPoint);
  }
}

function sortByMaturity<T extends WithdrawalDepositCandidate>(
  deposits: readonly T[],
  tip: ccc.ClientBlockHeader,
): T[] {
  return deposits.toSorted((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
  );
}
