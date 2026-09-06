import { ccc } from "@ckb-ccc/core";
import { receiptPhase2Capacity } from "@ickb/sdk";

import { CKB_RESERVE } from "../policy/constants.ts";
import { DIRECT_DEPOSIT_FEE_HEADROOM, maxBigInt } from "./support.ts";
import type {
  BotDecisionTranscript,
  BotState,
  RebalanceOutcome,
  Runtime,
} from "./types.ts";

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
  rebalance: RebalanceOutcome;
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
  rebalance: RebalanceOutcome,
): bigint {
  return rebalance.kind === "deposit"
    ? state.depositCapacity + receiptPhase2Capacity(runtime.primaryLock)
    : 0n;
}

function withdrawalRequestCost(runtime: Runtime, rebalance: RebalanceOutcome): bigint {
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
  rebalance: RebalanceOutcome,
): Pick<BotDecisionTranscript["audit"], "selectedRing"> {
  const ring = "diagnostics" in rebalance ? rebalance.diagnostics?.ring : undefined;
  if (ring === undefined) {
    return {};
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- policy ring diagnostics are built from ringSegments, so the target index points at an existing segment.
  const targetSegment = ring.segments[ring.targetSegmentIndex]!;
  const totals = {
    emptySegmentCount: 0,
    protectedDepositCount: 0,
    protectedUdtValue: 0n,
    surplusDepositCount: 0,
    surplusUdtValue: 0n,
  };
  let heaviest = targetSegment;
  for (const segment of ring.segments) {
    totals.emptySegmentCount += segment.depositCount === 0 ? 1 : 0;
    totals.protectedDepositCount += segment.protectedDepositCount;
    totals.protectedUdtValue += segment.protectedUdtValue;
    totals.surplusDepositCount += segment.surplusDepositCount;
    totals.surplusUdtValue += segment.surplusUdtValue;
    heaviest = segment.udtValue > heaviest.udtValue ? segment : heaviest;
  }
  return {
    selectedRing: {
      poolDepositCount: ring.poolDepositCount,
      ringLength: ring.ringLength,
      segmentCount: ring.segmentCount,
      targetSegmentIndex: ring.targetSegmentIndex,
      targetDepositCount: targetSegment.depositCount,
      targetUdtValue: ring.targetSegmentUdtValue,
      totalPoolUdt: ring.totalPoolUdt,
      ...totals,
      nonemptySegmentCount: ring.segments.length - totals.emptySegmentCount,
      heaviestSegmentIndex: heaviest.index,
      heaviestSegmentDepositCount: heaviest.depositCount,
      heaviestSegmentUdtValue: heaviest.udtValue,
      canCreateRingInventory: ring.canCreateRingInventory,
      shouldBootstrapRing: ring.shouldBootstrapRing,
    },
  };
}
