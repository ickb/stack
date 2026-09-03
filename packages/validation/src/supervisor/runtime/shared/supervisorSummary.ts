import { TX_CREATING_OUTCOMES, type OutcomeKind } from "./supervisorConstants.ts";
import type {
  Classification,
  PublicStateAssumption,
  TesterOrderEvidence,
} from "./supervisorTypes.ts";

export function aggregateClassifications(
  classifications: Classification[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const classification of classifications) {
    counts.set(classification.outcome, (counts.get(classification.outcome) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

export function uniqueTxHashesByOutcome(
  classifications: Classification[],
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(txHashesByOutcome(classifications)).map(([outcome, hashes]) => [
      outcome,
      [...new Set(hashes)],
    ]),
  );
}

export function txHashesByOutcome(
  classifications: Classification[],
): Record<string, string[]> {
  const hashes = new Map<string, string[]>();
  for (const classification of classifications) {
    if (classification.txHashes.length === 0) {
      continue;
    }
    hashes.set(classification.outcome, [
      ...(hashes.get(classification.outcome) ?? []),
      ...classification.txHashes,
    ]);
  }
  return Object.fromEntries(hashes);
}

export function testerOrderEvidenceByOutcome(
  classifications: Classification[],
): Array<TesterOrderEvidence & { outcome: OutcomeKind; txHashes: string[] }> {
  return classifications.flatMap((classification) =>
    classification.testerOrder === undefined
      ? []
      : [
          {
            outcome: classification.outcome,
            txHashes: classification.txHashes,
            ...classification.testerOrder,
          },
        ],
  );
}

export function txCreatingHashCountTotal(classifications: Classification[]): number {
  return classifications.reduce(
    (sum, classification) => sum + txCreatingHashCount(classification),
    0,
  );
}

export function txCreatingHashCount(classification: Classification): number {
  return TX_CREATING_OUTCOMES.has(classification.outcome)
    ? classification.txHashes.length
    : 0;
}

export function txCreatingUniqueHashCountTotal(
  classifications: Classification[],
): number {
  const hashes = new Set<string>();
  for (const classification of classifications) {
    if (!TX_CREATING_OUTCOMES.has(classification.outcome)) {
      continue;
    }
    for (const hash of classification.txHashes) {
      hashes.add(hash);
    }
  }
  return hashes.size;
}

export function botNoActionReason(
  reason: string,
  publicState: PublicStateAssumption | undefined,
): string {
  if (publicState?.rebalanceReason === undefined) {
    return `bot skipped: ${reason}`;
  }
  const readyPoolDeposits =
    publicState.readyPoolDepositCount === undefined
      ? "unknown"
      : String(publicState.readyPoolDepositCount);
  return `bot skipped: ${reason}; rebalance=${publicState.rebalanceKind ?? "unknown"}/${publicState.rebalanceReason}; readyPoolDeposits=${readyPoolDeposits}`;
}

export function txCreatingOutcomeCount(classifications: Classification[]): number {
  return classifications.filter((classification) =>
    TX_CREATING_OUTCOMES.has(classification.outcome),
  ).length;
}
