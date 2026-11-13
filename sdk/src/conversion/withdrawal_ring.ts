import { ccc } from "@ckb-ccc/core";
import type { DepositCell } from "../logic.ts";
import { ICKB_DEPOSIT_CAP } from "../udt.ts";

/**
 * Ring segment of pool deposits grouped by maturity around the DAO cycle.
 */
export interface RingSegment {
  /** Deposits assigned to this segment. */
  deposits: DepositCell[];

  /** Total iCKB value of deposits in this segment. */
  udtValue: bigint;
}

/**
 * Splits pool deposits into power-of-two maturity ring segments, one segment per two
 * deposit caps of pool iCKB.
 */
export function ringSegments(poolDeposits: readonly DepositCell[]): RingSegment[] {
  // Value, not count: zero-value deposits, made without iCKB Logic running, must not add segments.
  // Two caps per segment, not one: the room the bot's own fills need, see node/docs/maturity_ring.md.
  const totalUdt = poolDeposits.reduce((sum, deposit) => sum + deposit.udtValue, 0n);
  let segmentCount = 1;
  while (BigInt(segmentCount) * 2n * ICKB_DEPOSIT_CAP < totalUdt) {
    segmentCount *= 2;
  }
  const segments = Array.from({ length: segmentCount }, (): RingSegment => ({
    deposits: [],
    udtValue: 0n,
  }));

  // The ring is one DAO cycle round, so a claim rolled a cycle lands in the same segment.
  for (const deposit of poolDeposits) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringSegmentIndex returns 0 <= index < segmentCount.
    const segment = segments[ringSegmentIndex(deposit.claimEpoch, segmentCount)]!;
    segment.deposits.push(deposit);
    segment.udtValue += deposit.udtValue;
  }

  return segments;
}

/** The segment index an epoch falls in, for a deposit's claim or the tip. */
export function ringSegmentIndex(epoch: ccc.Epoch, segmentCount: number): number {
  const { denominator } = epoch;
  if (denominator <= 0n) {
    throw new Error("Epoch denominator must be positive");
  }
  const scaled = epoch.integer * denominator + epoch.numerator;
  const ring = ccc.Epoch.OneNervosDaoCycle.integer * denominator;
  const wrapped = ((scaled % ring) + ring) % ring;
  return Number((wrapped * BigInt(segmentCount)) / ring);
}

/**
 * Returns a filter that excludes the ring anchor deposits from surplus selection: each
 * segment keeps its anchor, the largest deposit not in `ready`, else the largest one.
 */
export function ringSurplusDepositFilter(
  poolDeposits: readonly DepositCell[],
  ready: readonly DepositCell[],
): (deposit: DepositCell) => boolean {
  const isReady = new Set(ready.map((deposit) => deposit.cell.outPoint.toHex()));
  // An empty segment has no anchor; its undefined key matches no deposit.
  const anchors = new Set(
    ringSegments(poolDeposits).map((segment) =>
      segment.deposits
        .reduce<DepositCell | undefined>(
          (best, deposit) =>
            best === undefined || isBetterRingAnchor(deposit, best, isReady)
              ? deposit
              : best,
          undefined,
        )
        ?.cell.outPoint.toHex(),
    ),
  );
  return (deposit) => !anchors.has(deposit.cell.outPoint.toHex());
}

function isBetterRingAnchor(
  candidate: DepositCell,
  current: DepositCell,
  isReady: ReadonlySet<string>,
): boolean {
  const candidateReady = isReady.has(candidate.cell.outPoint.toHex());
  if (candidateReady !== isReady.has(current.cell.outPoint.toHex())) {
    return !candidateReady;
  }
  return candidate.udtValue > current.udtValue;
}

/**
 * Walks the candidates in the given order and takes each one that still fits under
 * `maxAmount`, up to `maxCount`, the most requests the caller's transaction holds beside
 * its own outputs; the caller chooses the order, earliest claim first for a user (the wait
 * they feel), surplus before anchors for the bot.
 */
export function fitWithdrawalDeposits(
  candidates: readonly DepositCell[],
  maxAmount: bigint,
  maxCount: number,
): DepositCell[] {
  const deposits: DepositCell[] = [];
  let total = 0n;
  for (const deposit of candidates) {
    if (deposits.length === maxCount) {
      break;
    }
    if (total + deposit.udtValue > maxAmount) {
      continue;
    }
    total += deposit.udtValue;
    deposits.push(deposit);
  }
  return deposits;
}

/** Earliest claim first: the deposit that turns into CKB soonest. */
export function sortByClaim(deposits: readonly DepositCell[]): DepositCell[] {
  return deposits.toSorted((left, right) => left.claimEpoch.compare(right.claimEpoch));
}
