import type { ccc } from "@ckb-ccc/core";
import { jsonLogReplacer, writeJsonLine, type SupportedChain } from "@ickb/node-utils";
import type { RingDiagnostics, RingSegmentDiagnostics } from "../policy/types.ts";
import { transactionShape } from "../runtime/support.ts";
import type {
  BotActions,
  BotDecisionSkipReason,
  BotDecisionTranscript,
  BotStateSummary,
  BuildTransactionResult,
} from "../runtime/types.ts";
import {
  ringSegmentsArtifact,
  writeBotArtifact,
  type BotArtifactRef,
} from "./artifacts.ts";
import { logValue } from "./logValue.ts";

const BOT_EVENT_VERSION = 1;

export type BotEventType =
  | "bot.run.started"
  | "bot.chain.preflight"
  | "bot.iteration.started"
  | "bot.state.read"
  | "bot.match.evaluated"
  | "bot.rebalance.evaluated"
  | "bot.decision.skipped"
  | "bot.transaction.built"
  | "bot.transaction.sent"
  | "bot.transaction.confirmation"
  | "bot.transaction.committed"
  | "bot.transaction.failed"
  | "bot.iteration.failed";

interface BotEventIdentity {
  version: typeof BOT_EVENT_VERSION;
  app: "bot";
  chain: SupportedChain;
  runId: string;
  iterationId: number;
  timestamp: string;
  type: BotEventType;
}

export type BotEvent = BotEventIdentity & Record<string, unknown>;
export type { BotArtifactRef } from "./artifacts.ts";

/**
 * Emits versioned bot events as JSON-safe records.
 */
export class BotEventEmitter {
  private readonly context: {
    chain: SupportedChain;
    artifactRefPrefix?: string;
    artifactRoot?: string;
    runId: string;
    write?: (event: BotEvent) => void;
  };

  constructor(context: {
    chain: SupportedChain;
    artifactRefPrefix?: string;
    artifactRoot?: string;
    runId: string;
    write?: (event: BotEvent) => void;
  }) {
    this.context = context;
  }

  public emit(
    iterationId: number,
    type: BotEventType,
    fields: Record<string, unknown> = {},
  ): BotEvent {
    const event: BotEvent = {
      ...jsonSafeEventFields(fields),
      version: BOT_EVENT_VERSION,
      app: "bot",
      chain: this.context.chain,
      runId: this.context.runId,
      iterationId,
      timestamp: new Date().toISOString(),
      type,
    };
    (this.context.write ?? writeJsonLine)(event);
    return event;
  }

  /**
   * Writes a content-addressed artifact and returns its public reference.
   *
   * @returns `undefined` when artifact output is not configured.
   */
  public async writeArtifact(
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<BotArtifactRef | undefined> {
    const { artifactRoot, artifactRefPrefix } = this.context;
    if (artifactRoot === undefined || artifactRefPrefix === undefined) {
      return undefined;
    }
    return writeBotArtifact({
      artifactRefPrefix,
      artifactRoot,
      kind,
      payload,
    });
  }
}

export function createRunId(): string {
  return `${new Date().toISOString()}-${process.pid.toString(36)}`;
}

/**
 * Emits the public decision events for a build result.
 *
 * @remarks Full ring diagnostics are kept in evaluation events but stripped
 * from the embedded final decision transcript to keep terminal events bounded.
 */
export async function emitDecisionEvents(
  emitter: BotEventEmitter,
  iterationId: number,
  result: BuildTransactionResult,
): Promise<void> {
  const { decision } = result;
  const finalDecision = finalDecisionTranscript(decision);
  emitter.emit(iterationId, "bot.match.evaluated", {
    match: decision.match,
    orders: decision.orders,
  });
  const rebalance = await artifactedRebalance(decision.rebalance, emitter);
  emitter.emit(iterationId, "bot.rebalance.evaluated", {
    rebalance,
    poolDeposits: decision.poolDeposits,
  });

  if (result.kind === "skipped") {
    emitter.emit(iterationId, "bot.decision.skipped", {
      reason: result.reason,
      actions: result.actions,
      decision: finalDecision,
    });
    return;
  }

  emitter.emit(iterationId, "bot.transaction.built", {
    actions: result.actions,
    fee: decision.fee,
    transactionShape: decision.transactionShape,
    decision: finalDecision,
  });
}

export function transactionSummary(
  tx: ccc.Transaction,
  fee: bigint,
  feeRate: ccc.Num,
): Record<string, unknown> {
  return {
    fee,
    feeRate,
    shape: transactionShape(tx),
  };
}

export function lowCapitalSkipDecision(summary: BotStateSummary): {
  reason: BotDecisionSkipReason;
  actions: BotActions;
  state: BotStateSummary;
  deficit: bigint;
} {
  return {
    reason: "capital_below_minimum",
    actions: emptyActions(),
    state: summary,
    deficit: summary.balances.minimumCkbCapital - summary.balances.totalEquivalentCkb,
  };
}

function finalDecisionTranscript(decision: BotDecisionTranscript): BotDecisionTranscript {
  if (decision.rebalance.diagnostics === undefined) {
    return decision;
  }
  const rebalance = { ...decision.rebalance };
  delete rebalance.diagnostics;
  return {
    ...decision,
    rebalance,
  };
}

async function artifactedRebalance(
  rebalance: BotDecisionTranscript["rebalance"],
  emitter: BotEventEmitter,
): Promise<Record<string, unknown>> {
  const ring = rebalance.diagnostics?.ring;
  if (ring === undefined || ring.segments.length === 0) {
    return { ...rebalance };
  }
  let segmentsRef: BotArtifactRef | undefined;
  try {
    segmentsRef = await emitter.writeArtifact("bot.ringSegments", {
      ring: ringSegmentsArtifact(ring),
    });
  } catch (error) {
    return {
      ...rebalance,
      diagnostics: {
        ...rebalance.diagnostics,
        ring: {
          ...ring,
          artifactWriteFailed: publicErrorMessage(error),
        },
      },
    };
  }
  if (segmentsRef === undefined) {
    return { ...rebalance };
  }
  return {
    ...rebalance,
    diagnostics: {
      ...rebalance.diagnostics,
      ring: compactRingDiagnostics(ring, segmentsRef),
    },
  };
}

function compactRingDiagnostics(
  ring: RingDiagnostics,
  segmentsRef: BotArtifactRef,
): Omit<RingDiagnostics, "segments"> & Record<string, unknown> {
  const stats = ringSegmentStats(ring.segments);
  return {
    poolDepositCount: ring.poolDepositCount,
    canCreateRingInventory: ring.canCreateRingInventory,
    shouldBootstrapRing: ring.shouldBootstrapRing,
    ringLength: ring.ringLength,
    segmentCount: ring.segmentCount,
    targetSegmentIndex: ring.targetSegmentIndex,
    targetSegmentUdtValue: ring.targetSegmentUdtValue,
    totalPoolUdt: ring.totalPoolUdt,
    depositsShareOneSegment: ring.depositsShareOneSegment,
    emptySegmentCount: stats.emptySegmentCount,
    nonemptySegmentCount: ring.segments.length - stats.emptySegmentCount,
    protectedDepositCount: stats.protectedDepositCount,
    protectedUdtValue: stats.protectedUdtValue,
    surplusDepositCount: stats.surplusDepositCount,
    surplusUdtValue: stats.surplusUdtValue,
    heaviestSegmentIndex: stats.heaviest.index,
    heaviestSegmentDepositCount: stats.heaviest.depositCount,
    heaviestSegmentUdtValue: stats.heaviest.udtValue,
    segmentsRef,
  };
}

function ringSegmentStats(segments: RingSegmentDiagnostics[]): {
  emptySegmentCount: number;
  heaviest: RingSegmentDiagnostics;
  protectedDepositCount: number;
  protectedUdtValue: bigint;
  surplusDepositCount: number;
  surplusUdtValue: bigint;
} {
  let emptySegmentCount = 0;
  const heaviest = segments.reduce(
    (best, segment) => (segment.udtValue > best.udtValue ? segment : best),
    {
      index: 0,
      depositCount: 0,
      udtValue: -1n,
      isTarget: false,
      protectedDepositCount: 0,
      protectedUdtValue: 0n,
      protectedOutPoints: [],
      surplusDepositCount: 0,
      surplusUdtValue: 0n,
      surplusOutPoints: [],
    },
  );
  let protectedDepositCount = 0;
  let protectedUdtValue = 0n;
  let surplusDepositCount = 0;
  let surplusUdtValue = 0n;
  for (const segment of segments) {
    emptySegmentCount += segment.depositCount === 0 ? 1 : 0;
    protectedDepositCount += segment.protectedDepositCount;
    protectedUdtValue += segment.protectedUdtValue;
    surplusDepositCount += segment.surplusDepositCount;
    surplusUdtValue += segment.surplusUdtValue;
  }
  return {
    emptySegmentCount,
    heaviest,
    protectedDepositCount,
    protectedUdtValue,
    surplusDepositCount,
    surplusUdtValue,
  };
}

function emptyActions(): BotActions {
  return {
    collectedOrders: 0,
    completedDeposits: 0,
    matchedOrders: 0,
    deposits: 0,
    withdrawalRequests: 0,
    withdrawals: 0,
  };
}

function jsonSafeEventFields(fields: Record<string, unknown>): Record<string, unknown> {
  return parsedRecord(
    JSON.parse(JSON.stringify(logValue(fields, new Set<unknown>()), jsonLogReplacer)),
  );
}

function publicErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown artifact write error";
}

function parsedRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}
