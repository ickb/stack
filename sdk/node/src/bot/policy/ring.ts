import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../../../../src/core/index.ts";
import {
  ringSegments,
  ringTargetSegmentIndex,
} from "../../../../src/core/withdrawal_selection.ts";

/** Compact evidence of the pool ring the policy evaluated, as the journal carries it. */
export interface RingSummary {
  poolDepositCount: number;
  segmentCount: number;
  targetSegmentIndex: number;
  targetUdtValue: bigint;
  totalPoolUdt: bigint;
}

/**
 * Whether the ring segment containing the tip lacks coverage: under half its equal share
 * of the pool's iCKB. The full public pool shapes the ring, not only ready deposits.
 */
export function ringCoverage(
  poolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): { needsSeed: boolean; summary: RingSummary } {
  const segments = ringSegments(poolDeposits);
  const targetSegmentIndex = ringTargetSegmentIndex(tip, segments.length);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringTargetSegmentIndex returns 0 <= index < segmentCount, and ringSegments always returns at least one segment.
  const target = segments[targetSegmentIndex]!;
  const totalPoolUdt = segments.reduce((sum, segment) => sum + segment.udtValue, 0n);
  return {
    needsSeed:
      poolDeposits.length === 0 ||
      2n * target.udtValue * BigInt(segments.length) < totalPoolUdt,
    summary: {
      poolDepositCount: poolDeposits.length,
      segmentCount: segments.length,
      targetSegmentIndex,
      targetUdtValue: target.udtValue,
      totalPoolUdt,
    },
  };
}
