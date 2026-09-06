import type { ccc } from "@ckb-ccc/core";
import { MAX_WITHDRAWAL_REQUESTS } from "../client/sdk_types.ts";
import type { IckbDepositCell } from "../core/index.ts";
import { compareBigInt } from "../utils/index.ts";
import {
  BEST_FIT_SEARCH_CANDIDATES,
  prepareReadyDepositExactCountSelector,
  selectReadyDeposits,
  selectReadyDepositsForExactCounts,
} from "./withdrawal_best_fit.ts";
import { depositKey } from "./withdrawal_ring.ts";
import type {
  ExactReadyWithdrawalSelectionOptions,
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
 * Selects ready deposits for a withdrawal request, returning an empty selection
 * when the amount or count constraints cannot be satisfied.
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
    minCount = 1,
    maxCount = MAX_WITHDRAWAL_REQUESTS,
    canSelectDeposit = (): boolean => true,
    requiredLiveDepositFor,
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
    }),
    requiredLiveDepositFor,
  );
}

export function selectReadyWithdrawalDepositCandidatesForCounts<
  T extends WithdrawalDepositCandidate = IckbDepositCell,
>(
  options: Omit<ExactReadyWithdrawalSelectionOptions<T>, "count"> & {
    counts: readonly number[];
    score: (deposit: T) => bigint;
    maturityBucket: (deposit: T) => bigint;
  },
): ReadonlyMap<number, Array<ReadyWithdrawalSelection<T>>> {
  assertReadyWithdrawalDeposits(options.readyDeposits);
  const counts = [...new Set(options.counts)];
  const selectionsByCount = new Map<number, Array<ReadyWithdrawalSelection<T>>>(
    counts.map((count): [number, Array<ReadyWithdrawalSelection<T>>] => [count, []]),
  );
  const seenByCount = new Map<number, Set<string>>(
    counts.map((count): [number, Set<string>] => [count, new Set()]),
  );
  const indexByDeposit = new Map(
    options.readyDeposits.map((deposit, index): [T, number] => [deposit, index]),
  );
  const canSelectDeposit = options.canSelectDeposit ?? ((): boolean => true);
  let selectScoredCounts:
    ((deposits: readonly T[]) => ReadonlyMap<number, T[]>) | undefined;
  let selectUnscoredCounts = selectScoredCounts;
  const addSelections = (depositsByCount: ReadonlyMap<number, T[]>): void => {
    for (const [count, selections] of selectionsByCount) {
      const deposits = depositsByCount.get(count);
      if (deposits?.length !== count) {
        continue;
      }

      const key = selectionKey(deposits, indexByDeposit);
      const seen = seenByCount.get(count);
      if (seen === undefined || seen.has(key)) {
        continue;
      }

      seen.add(key);
      selections.push(
        selectionWithRequiredLiveDeposits(deposits, options.requiredLiveDepositFor),
      );
    }
  };

  for (const bucket of uniqueBuckets(options.readyDeposits, options.maturityBucket)) {
    const candidates = sortByMaturity(
      options.readyDeposits.filter(
        (deposit) => options.maturityBucket(deposit) <= bucket,
      ),
      options.tip,
    ).filter(canSelectDeposit);
    if (
      selectScoredCounts === undefined &&
      candidates.length >= BEST_FIT_SEARCH_CANDIDATES
    ) {
      selectScoredCounts = prepareReadyDepositExactCountSelector(
        candidates,
        options.maxAmount,
        options.counts,
        options.score,
      );
      selectUnscoredCounts = prepareReadyDepositExactCountSelector(
        candidates,
        options.maxAmount,
        options.counts,
      );
    }
    const scoredByCount =
      selectScoredCounts?.(candidates) ??
      selectReadyDepositsForExactCounts(
        candidates,
        options.maxAmount,
        options.counts,
        options.score,
      );
    const unscoredByCount =
      selectUnscoredCounts?.(candidates) ??
      selectReadyDepositsForExactCounts(candidates, options.maxAmount, options.counts);
    addSelections(scoredByCount);
    addSelections(unscoredByCount);
  }

  return selectionsByCount;
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
  return (
    items
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- selections are built from the indexed readyDeposits array.
      .map((item) => String(indexByItem.get(item)!))
      .toSorted((left, right) => left.localeCompare(right))
      .join(",")
  );
}
