import type { ccc } from "@ckb-ccc/core";
import { MAX_WITHDRAWAL_REQUESTS } from "../client/sdk_types.ts";
import type { IckbDepositCell } from "../core/index.ts";
import { compareBigInt } from "../utils/index.ts";
import { depositKey } from "./withdrawal_ring.ts";
import type {
  ReadyWithdrawalSelection,
  ReadyWithdrawalSelectionOptions,
  WithdrawalDepositCandidate,
} from "./withdrawal_selection_types.ts";

export {
  ringRequiredLiveDepositFor,
  ringSegmentAnchor,
  ringSegments,
  ringSurplusDepositFilter,
  ringTargetSegmentIndex,
} from "./withdrawal_ring.ts";
export type { RingSegment } from "./withdrawal_ring.ts";
export type {
  ReadyWithdrawalSelection,
  ReadyWithdrawalSelectionOptions,
  WithdrawalDepositCandidate,
} from "./withdrawal_selection_types.ts";

/**
 * Selects ready deposits for withdrawal requests greedily by maturity.
 *
 * @remarks
 * The deposit closest to its cycle boundary turns into CKB soonest, which is the wait the
 * user feels, so candidates are walked from the earliest maturity and each one that still
 * fits under `maxAmount` is taken, up to `maxCount` (decisions amendment 40). How many of
 * the selected deposits one transaction can carry is decided later by completion, not here.
 *
 * @public
 */
export function selectReadyWithdrawalDeposits<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(options: ReadyWithdrawalSelectionOptions<T>): ReadyWithdrawalSelection<T> {
  assertReadyWithdrawalDeposits(options.readyDeposits);
  const {
    tip,
    maxAmount,
    readyDeposits,
    maxCount = MAX_WITHDRAWAL_REQUESTS,
    canSelectDeposit = (): boolean => true,
    requiredLiveDepositFor,
  } = options;
  const deposits: T[] = [];
  let total = 0n;
  for (const deposit of sortByMaturity(readyDeposits, tip)) {
    if (deposits.length >= maxCount) {
      break;
    }
    if (!canSelectDeposit(deposit) || total + deposit.udtValue > maxAmount) {
      continue;
    }
    total += deposit.udtValue;
    deposits.push(deposit);
  }
  return withRequiredLiveDeposits(deposits, requiredLiveDepositFor);
}

/**
 * Pairs deposits to spend with the live anchors they depend on, without duplicates.
 *
 * @public
 */
export function withRequiredLiveDeposits<T extends WithdrawalDepositCandidate>(
  deposits: T[],
  requiredLiveDepositFor?: (deposit: T) => T | undefined,
): ReadyWithdrawalSelection<T> {
  const requiredLiveDeposits: T[] = [];
  const seen = new Set(deposits.map(depositKey));
  for (const deposit of deposits) {
    const requiredLiveDeposit = requiredLiveDepositFor?.(deposit);
    if (requiredLiveDeposit === undefined || seen.has(depositKey(requiredLiveDeposit))) {
      continue;
    }
    seen.add(depositKey(requiredLiveDeposit));
    requiredLiveDeposits.push(requiredLiveDeposit);
  }
  return { deposits, requiredLiveDeposits };
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
