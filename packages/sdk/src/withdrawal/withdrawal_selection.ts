import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import { compareBigInt } from "@ickb/utils";
import {
  DEFAULT_MAX_WITHDRAWAL_REQUESTS,
  selectReadyDeposits,
} from "./withdrawal_best_fit.ts";
import { depositKey } from "./withdrawal_ring.ts";
import type {
  ExactReadyWithdrawalSelectionOptions,
  ReadyWithdrawalSelection,
  ReadyWithdrawalSelectionOptions,
  ScoredExactReadyWithdrawalSelectionOptions,
  ScoredReadyWithdrawalSelectionOptions,
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
 * Selects ready deposits for a withdrawal request, returning an empty selection
 * when the amount or count constraints cannot be satisfied.
 *
 * @public
 */
export function selectReadyWithdrawalDeposits<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(options: ReadyWithdrawalSelectionOptions<T>): ReadyWithdrawalSelection<T> {
  assertReadyWithdrawalDeposits(options.readyDeposits);
  return selectReadyWithdrawalDepositsWithScore(options);
}

/**
 * Returns distinct exact-count ready withdrawal selections across maturity buckets.
 */
export function selectExactReadyWithdrawalDepositCandidates<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(
  options: ExactReadyWithdrawalSelectionOptions<T> & {
    score: (deposit: T) => bigint;
    maturityBucket: (deposit: T) => bigint;
  },
): Array<ReadyWithdrawalSelection<T>> {
  assertReadyWithdrawalDeposits(options.readyDeposits);
  const selections: Array<ReadyWithdrawalSelection<T>> = [];
  const seen = new Set<string>();
  const indexByDeposit = new Map(
    options.readyDeposits.map((deposit, index): [T, number] => [deposit, index]),
  );
  const addSelection = (selection: ReadyWithdrawalSelection<T> | undefined): void => {
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
      ...(options.canSelectDeposit === undefined
        ? {}
        : { canSelectDeposit: options.canSelectDeposit }),
      ...(options.requiredLiveDepositFor === undefined
        ? {}
        : { requiredLiveDepositFor: options.requiredLiveDepositFor }),
    };
    addSelection(
      selectReadyWithdrawalCandidateWithScore({
        ...baseOptions,
        score: options.score,
      }),
    );
    addSelection(selectReadyWithdrawalCandidateWithScore(baseOptions));
  }

  return selections;
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

function selectReadyWithdrawalCandidateWithScore<T extends WithdrawalDepositCandidate>(
  options: ScoredExactReadyWithdrawalSelectionOptions<T>,
): ReadyWithdrawalSelection<T> | undefined {
  const { count, ...selectionOptions } = options;
  const selection = selectReadyWithdrawalDepositsWithScore({
    ...selectionOptions,
    minCount: count,
    maxCount: count,
  });

  return selection.deposits.length === count ? selection : undefined;
}

function selectReadyWithdrawalDepositsWithScore<T extends WithdrawalDepositCandidate>(
  options: ScoredReadyWithdrawalSelectionOptions<T>,
): ReadyWithdrawalSelection<T> {
  const {
    tip,
    maxAmount,
    readyDeposits,
    minCount = 1,
    maxCount = DEFAULT_MAX_WITHDRAWAL_REQUESTS,
    canSelectDeposit = (): boolean => true,
    requiredLiveDepositFor,
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

  const candidates = sortByMaturity(readyDeposits, tip).filter(canSelectDeposit);
  return selectionWithRequiredLiveDeposits(
    selectReadyDeposits(candidates, maxAmount, {
      maxCount,
      minCount: requiredCount,
      ...(score === undefined ? {} : { score }),
    }),
    requiredLiveDepositFor,
  );
}

function selectionWithRequiredLiveDeposits<T extends WithdrawalDepositCandidate>(
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

function sortByMaturity<T extends WithdrawalDepositCandidate>(
  deposits: readonly T[],
  tip: ccc.ClientBlockHeader,
): T[] {
  return deposits.toSorted((left, right) =>
    compareBigInt(left.maturity.toUnix(tip), right.maturity.toUnix(tip)),
  );
}

function uniqueBuckets<T>(items: readonly T[], bucket: (item: T) => bigint): bigint[] {
  return [...new Set(items.map(bucket))].toSorted(compareBigInt);
}

function selectionKey<T>(
  items: readonly T[],
  indexByItem: ReadonlyMap<T, number>,
): string {
  return items
    .map((item) => String(indexByItem.get(item)))
    .toSorted((left, right) => left.localeCompare(right))
    .join(",");
}
