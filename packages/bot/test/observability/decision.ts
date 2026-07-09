import { describe, expect, it } from "vitest";
import {
  BotEventEmitter,
  emitDecisionEvents,
  lowCapitalSkipDecision,
  type BotArtifactRef,
} from "../../src/observability/events.ts";
import type { BotStateSummary } from "../../src/runtime/types.ts";
import {
  BOT_OBSERVABILITY_SUITE,
  NO_ACTION_SKIP_RESULT,
  noActions,
  record,
} from "./fixtures/observability.ts";

const RING_SEGMENTS_ARTIFACT_PATH = "artifacts/ringSegments/sha256-abc.json";
const REBALANCE_EVENT = "rebalance event";

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("emits compact rebalance events with full ring artifacts", async () => {
    const { artifacts, emitter, events } = artifactCapturingEmitter();

    await emitDecisionEvents(emitter, 1, NO_ACTION_SKIP_RESULT);

    expectCompactRingEvents(events);
    expectRingArtifact(artifacts);
    const decision = record(record(events[2], "decision event")["decision"], "decision");
    expect(decision["rebalance"]).not.toHaveProperty("diagnostics");
  });

  it("keeps inline ring diagnostics when artifact output is disabled", async () => {
    const events: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        events.push(event);
      },
    });

    await emitDecisionEvents(emitter, 1, NO_ACTION_SKIP_RESULT);

    const rebalance = record(
      record(events[1], REBALANCE_EVENT)["rebalance"],
      "rebalance",
    );
    const ring = record(record(rebalance["diagnostics"], "diagnostics")["ring"], "ring");
    expect(ring["segments"]).toHaveLength(2);
    expect(ring).not.toHaveProperty("segmentsRef");
  });

  it("records public artifact write failures in ring diagnostics", async () => {
    const { emitter, events } = artifactCapturingEmitter();
    emitter.writeArtifact = async (): Promise<BotArtifactRef> => {
      await Promise.resolve();
      throw new Error("disk full");
    };

    await emitDecisionEvents(emitter, 1, NO_ACTION_SKIP_RESULT);

    const rebalance = record(
      record(events[1], REBALANCE_EVENT)["rebalance"],
      "rebalance",
    );
    const ring = record(record(rebalance["diagnostics"], "diagnostics")["ring"], "ring");
    expect(ring["artifactWriteFailed"]).toBe("disk full");
    expect(ring["segments"]).toHaveLength(2);
  });

  it("records unknown artifact write failures without leaking thrown values", async () => {
    const { emitter, events } = artifactCapturingEmitter();
    emitter.writeArtifact = async (): Promise<BotArtifactRef> => {
      await new Promise<BotArtifactRef>((_resolve, reject) => {
        Reflect.apply(reject, undefined, ["private-ish raw thrown value"]);
      });
      throw new Error("unreachable");
    };

    await emitDecisionEvents(emitter, 1, NO_ACTION_SKIP_RESULT);

    const rebalance = record(
      record(events[1], REBALANCE_EVENT)["rebalance"],
      "rebalance",
    );
    const ring = record(record(rebalance["diagnostics"], "diagnostics")["ring"], "ring");
    expect(ring["artifactWriteFailed"]).toBe("Unknown artifact write error");
    expect(JSON.stringify(ring)).not.toContain("private-ish raw thrown value");
  });
});

function artifactCapturingEmitter(): {
  artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
  emitter: BotEventEmitter;
  events: unknown[];
} {
  const events: unknown[] = [];
  const artifacts: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const emitter = new BotEventEmitter({
    chain: "testnet",
    runId: "run-1",
    write: (event): void => {
      events.push(event);
    },
  });
  emitter.writeArtifact = async (kind, payload): Promise<BotArtifactRef> => {
    await Promise.resolve();
    artifacts.push({ kind, payload });
    return {
      kind,
      hash: "sha256:abc",
      path: RING_SEGMENTS_ARTIFACT_PATH,
    };
  };
  return { artifacts, emitter, events };
}

function expectCompactRingEvents(events: unknown[]): void {
  expect(events).toHaveLength(3);
  expect(events).toMatchObject([
    { type: "bot.match.evaluated" },
    {
      type: "bot.rebalance.evaluated",
      rebalance: {
        diagnostics: {
          ring: {
            poolDepositCount: 2,
            emptySegmentCount: 1,
            nonemptySegmentCount: 1,
            protectedDepositCount: 1,
            protectedUdtValue: "2",
            surplusDepositCount: 1,
            surplusUdtValue: "0",
            heaviestSegmentIndex: 0,
            segmentsRef: {
              kind: "bot.ringSegments",
              hash: "sha256:abc",
              path: RING_SEGMENTS_ARTIFACT_PATH,
            },
          },
        },
      },
    },
    {
      type: "bot.decision.skipped",
      reason: "no_actions",
      actions: noActions,
      decision: {
        rebalance: { kind: "none", reason: "no_withdrawable_ickb" },
        skip: { reason: "no_actions" },
      },
    },
  ]);
  const rebalanceEvent = record(events[1], REBALANCE_EVENT);
  const rebalance = record(rebalanceEvent["rebalance"], "rebalance");
  const diagnostics = record(rebalance["diagnostics"], "diagnostics");
  const ring = record(diagnostics["ring"], "ring");
  expect(ring).not.toHaveProperty("segments");
}

function expectRingArtifact(
  artifacts: Array<{ kind: string; payload: Record<string, unknown> }>,
): void {
  expect(artifacts).toMatchObject([
    {
      kind: "bot.ringSegments",
      payload: {
        ring: {
          segmentCount: 2,
          segments: [
            {
              index: 0,
              depositCount: 2,
              udtValue: 2n,
              protectedDepositCount: 1,
              protectedUdtValue: 2n,
              protectedOutPoints: ["0xprotected"],
              surplusDepositCount: 1,
              surplusUdtValue: 0n,
              surplusOutPoints: ["0xsurplus"],
            },
            {
              index: 1,
              depositCount: 0,
              udtValue: 0n,
              protectedDepositCount: 0,
              protectedUdtValue: 0n,
              protectedOutPoints: [],
              surplusDepositCount: 0,
              surplusUdtValue: 0n,
              surplusOutPoints: [],
            },
          ],
        },
      },
    },
  ]);
}

describe(BOT_OBSERVABILITY_SUITE, () => {
  it("keeps low-capital safety skips state-only", () => {
    const state: BotStateSummary = {
      chainTip: {
        blockNumber: 1n,
        blockHash: `0x${"11".repeat(32)}`,
        timestamp: 2n,
        epoch: { integer: 3n, numerator: 0n, denominator: 1n },
      },
      balances: {
        availableCkb: 0n,
        unavailableCkb: 0n,
        totalCkb: 0n,
        availableIckb: 0n,
        totalEquivalentCkb: 0n,
        totalEquivalentIckb: 0n,
        minimumCkbCapital: 1n,
        spendableCkb: 0n,
        matchableCkb: 0n,
      },
      orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
      withdrawals: { readyCount: 0, pendingCount: 0 },
      poolDeposits: { totalCount: 0, readyCount: 0 },
      exchangeRatio: { ckbScale: 1n, udtScale: 1n },
      depositCapacity: 0n,
      fee: { feeRate: 1n },
    };

    const skip = lowCapitalSkipDecision(state);

    expect(skip).toEqual({
      reason: "capital_below_minimum",
      actions: noActions,
      state,
      deficit: 1n,
    });
    expect(skip).not.toHaveProperty("decision");
  });
});
