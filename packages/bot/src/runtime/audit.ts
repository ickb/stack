import { ccc } from "@ckb-ccc/core";
import { receiptPhase2Capacity } from "@ickb/core";
import type { RebalancePlan, RingSegmentDiagnostics } from "../policy.ts";
import { CKB_RESERVE } from "../policy/constants.ts";
import { DIRECT_DEPOSIT_FEE_HEADROOM, maxBigInt } from "./support.ts";
import type { BotDecisionTranscript, BotState, Runtime } from "./types.ts";

const OWNED_OWNER_TYPE_BYTES = 33;
const OWNER_DATA_BYTES = 4;

export function auditSummary({
  runtime,
  state,
  match,
  rebalance,
  fee,
}: {
  runtime: Runtime;
  state: BotState;
  match: { ckbDelta: bigint; udtDelta: bigint };
  rebalance: RebalancePlan;
  fee?: bigint;
}): BotDecisionTranscript["audit"] {
  const directCost = directDepositCost(runtime, state, rebalance);
  const withdrawalCost = withdrawalRequestCost(runtime, rebalance);
  const estimatedFee = fee ?? 0n;
  // BEFORE EDITING, STOP AND PROVE, LOCAL SAFETY IS NOT ENOUGH:
  // - OWNER: bot available-CKB reserve policy.
  // - INVARIANT: reserve is based on projected available CKB, not actual plain-cell accounting.
  // - FAILURE MODE: plain-cell audits can block withdrawal requests that spend rent now to restore CKB later.
  const projectedPostTransactionCkb =
    state.availableCkbBalance +
    match.ckbDelta -
    directCost -
    withdrawalCost -
    estimatedFee;
  return {
    reserveCheck: {
      availableCkb: state.availableCkbBalance,
      matchCkbDelta: match.ckbDelta,
      rebalanceCkbCost: directCost + withdrawalCost,
      directDepositCost: directCost,
      withdrawalRequestCost: withdrawalCost,
      ...(fee === undefined ? {} : { estimatedFee: fee }),
      projectedPostTransactionCkb,
      reserve: CKB_RESERVE,
      deficit: maxBigInt(0n, CKB_RESERVE - projectedPostTransactionCkb),
      recoveryException: rebalance.kind === "withdraw" && match.ckbDelta >= 0n,
    },
    rebalanceCosts: {
      directDepositCapacity:
        state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock),
      directDepositFeeHeadroom: DIRECT_DEPOSIT_FEE_HEADROOM,
      directDepositCost: directCost,
      withdrawalRequestCost: withdrawalCost,
    },
    ...selectedRingAudit(rebalance),
  };
}

function directDepositCost(
  runtime: Runtime,
  state: BotState,
  rebalance: RebalancePlan,
): bigint {
  return rebalance.kind === "deposit"
    ? state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock)
    : 0n;
}

function withdrawalRequestCost(runtime: Runtime, rebalance: RebalancePlan): bigint {
  if (rebalance.kind !== "withdraw") {
    return 0n;
  }
  // Owner cells contain 8 capacity bytes, the account lock, a 33-byte type
  // script, and 4 bytes of owner data.
  const ownerCapacity =
    BigInt(
      8 + runtime.primaryLock.occupiedSize + OWNED_OWNER_TYPE_BYTES + OWNER_DATA_BYTES,
    ) * ccc.One;
  return BigInt(rebalance.deposits.length) * ownerCapacity;
}

function selectedRingAudit(
  rebalance: RebalancePlan,
): Pick<BotDecisionTranscript["audit"], "selectedRing"> {
  const ring = rebalance.diagnostics?.ring;
  if (ring === undefined) {
    return {};
  }
  const segmentStats = selectedRingSegmentStats(ring.segments);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- policy ring diagnostics are built from ringSegments, so the target index points at an existing segment.
  const targetSegment = ring.segments[ring.targetSegmentIndex]!;
  return {
    selectedRing: {
      targetSegmentIndex: ring.targetSegmentIndex,
      targetDepositCount: targetSegment.depositCount,
      targetUdtValue: ring.targetSegmentUdtValue,
      totalPoolUdt: ring.totalPoolUdt,
      emptySegmentCount: segmentStats.emptySegmentCount,
      nonemptySegmentCount: ring.segments.length - segmentStats.emptySegmentCount,
      heaviestSegmentIndex: segmentStats.heaviest.index,
      heaviestSegmentDepositCount: segmentStats.heaviest.depositCount,
      heaviestSegmentUdtValue: segmentStats.heaviest.udtValue,
      canCreateRingInventory: ring.canCreateRingInventory,
      shouldBootstrapRing: ring.shouldBootstrapRing,
    },
  };
}

function selectedRingSegmentStats(segments: RingSegmentDiagnostics[]): {
  heaviest: RingSegmentDiagnostics;
  emptySegmentCount: number;
} {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- policy ring diagnostics are built from ringSegments, which always returns at least one segment.
  let heaviest = segments[0]!;
  let emptySegmentCount = 0;
  for (const segment of segments) {
    emptySegmentCount += segment.depositCount === 0 ? 1 : 0;
    heaviest = heavierRingSegment(heaviest, segment);
  }
  return { heaviest, emptySegmentCount };
}

function heavierRingSegment(
  current: RingSegmentDiagnostics,
  segment: RingSegmentDiagnostics,
): RingSegmentDiagnostics {
  return segment.udtValue > current.udtValue ? segment : current;
}
