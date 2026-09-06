import type { ccc } from "@ckb-ccc/core";
import {
  type IckbDepositCell,
  ringSegmentAnchor,
  ringSegments,
  ringTargetSegmentIndex,
} from "@ickb/sdk";

import { CKB_RESERVE } from "./constants.ts";
import type { RebalanceDiagnostics, RingSegmentDiagnostics } from "./types.ts";

const RING_LENGTH_EPOCHS = 180n;
const RING_SEGMENT_UNDERCOVERAGE_RATIO_DENOMINATOR = 2n;

/**
 * Evaluates whether the public pool ring needs a seed deposit in the target segment.
 *
 * @remarks Ring coverage uses the full public pool snapshot, not just ready
 * deposits, so seeding and surplus decisions preserve the DAO-cycle inventory shape.
 */
export function evaluateRingCoverage({
  poolDeposits,
  tip,
  ickbBalance,
  ckbBalance,
  directDepositCapacity,
  directDepositFeeHeadroom,
  ickbRefillThreshold,
}: {
  poolDeposits: readonly IckbDepositCell[];
  tip: ccc.ClientBlockHeader;
  ickbBalance: bigint;
  ckbBalance: bigint;
  directDepositCapacity: bigint;
  directDepositFeeHeadroom: bigint;
  ickbRefillThreshold: bigint;
}): {
  canSeed: boolean;
  diagnostics: RebalanceDiagnostics;
} {
  const canCreate = canCreateRingInventory({
    ickbBalance,
    ckbBalance,
    directDepositCapacity,
    directDepositFeeHeadroom,
    ickbRefillThreshold,
  });
  const layout = analyzeRingSegments(poolDeposits, tip);
  const diagnostics = ringDiagnostics(layout, poolDeposits.length, canCreate);
  const result = (
    needsSeed: boolean,
  ): { canSeed: boolean; diagnostics: RebalanceDiagnostics } => ({
    canSeed: needsSeed && canCreate,
    diagnostics,
  });

  if (poolDeposits.length === 0) {
    return result(true);
  }
  if (layout.totalPoolUdt <= 0n) {
    return result(false);
  }
  return result(
    isUnderCoveredRingSegment(
      layout.targetSegment.udtValue,
      layout.segmentCount,
      layout.totalPoolUdt,
    ),
  );
}

function canCreateRingInventory({
  ickbBalance,
  ckbBalance,
  directDepositCapacity,
  directDepositFeeHeadroom,
  ickbRefillThreshold,
}: {
  ickbBalance: bigint;
  ckbBalance: bigint;
  directDepositCapacity: bigint;
  directDepositFeeHeadroom: bigint;
  ickbRefillThreshold: bigint;
}): boolean {
  return (
    ickbBalance >= ickbRefillThreshold &&
    canFundDirectDeposit(ckbBalance, directDepositCapacity, directDepositFeeHeadroom)
  );
}

/** Returns true when available CKB can fund one direct deposit while preserving reserve. */
export function canFundDirectDeposit(
  ckbBalance: bigint,
  directDepositCapacity: bigint,
  directDepositFeeHeadroom: bigint,
): boolean {
  return ckbBalance >= directDepositCapacity + directDepositFeeHeadroom + CKB_RESERVE;
}

// BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
// - OWNER: shared SDK ring surplus filter.
// - INVARIANT: bot rebalancing follows full-pool ring buckets, while 15-minute ready buckets only rank already-valid candidates.
// - FAILURE MODE: local ready-bucket protection can block ring surplus withdrawals and leave the bot unable to recover CKB reserve.
function ringDiagnostics(
  layout: RingLayout,
  poolDepositCount: number,
  canCreateRingInventoryResult: boolean,
): RebalanceDiagnostics {
  return {
    ring: {
      poolDepositCount,
      canCreateRingInventory: canCreateRingInventoryResult,
      shouldBootstrapRing: canCreateRingInventoryResult && poolDepositCount === 0,
      ringLength: layout.ringLength,
      segmentCount: layout.segmentCount,
      targetSegmentIndex: layout.targetSegmentIndex,
      targetSegmentUdtValue: layout.targetSegment.udtValue,
      totalPoolUdt: layout.totalPoolUdt,
      segments: layout.segments.map(ringSegmentDiagnostics),
    },
  };
}

function ringSegmentDiagnostics(segment: RingPolicySegment): RingSegmentDiagnostics {
  const protectedDeposit = ringSegmentAnchor(segment.deposits);
  const surplusDeposits = segment.deposits.filter(
    (deposit) => deposit !== protectedDeposit,
  );
  const protectedUdtValue = protectedDeposit?.udtValue ?? 0n;
  const surplusUdtValue = surplusDeposits.reduce(
    (total, deposit) => total + deposit.udtValue,
    0n,
  );

  return {
    index: segment.index,
    depositCount: segment.deposits.length,
    udtValue: segment.udtValue,
    protectedDepositCount: protectedDeposit === undefined ? 0 : 1,
    protectedUdtValue,
    surplusDepositCount: surplusDeposits.length,
    surplusUdtValue,
  };
}

function analyzeRingSegments(
  poolDeposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
): RingLayout {
  const segments = ringSegments(poolDeposits);
  const segmentCount = segments.length;
  const targetSegmentIndex = ringTargetSegmentIndex(tip, segmentCount);
  const totalUdt = segments.reduce((sum, segment) => sum + segment.udtValue, 0n);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ringTargetSegmentIndex returns 0 <= index < segmentCount, and ringSegments always returns at least one segment.
  const targetSegment = segments[targetSegmentIndex]!;
  return {
    ringLength: RING_LENGTH_EPOCHS,
    segmentCount,
    targetSegmentIndex,
    targetSegment,
    totalPoolUdt: totalUdt,
    segments,
  };
}

function isUnderCoveredRingSegment(
  segmentUdtValue: bigint,
  segmentCount: number,
  totalRingUdt: bigint,
): boolean {
  // The target segment is under-covered when it holds less than half of its
  // equal-share iCKB coverage across the current ring partition.
  return (
    RING_SEGMENT_UNDERCOVERAGE_RATIO_DENOMINATOR *
      segmentUdtValue *
      BigInt(segmentCount) <
    totalRingUdt
  );
}

interface RingLayout {
  ringLength: bigint;
  segmentCount: number;
  targetSegmentIndex: number;
  targetSegment: RingPolicySegment;
  totalPoolUdt: bigint;
  segments: RingPolicySegment[];
}

interface RingPolicySegment {
  index: number;
  deposits: IckbDepositCell[];
  udtValue: bigint;
}
