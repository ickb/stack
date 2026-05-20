import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  BotEventEmitter,
  emitDecisionEvents,
  errorSummary,
  lowCapitalSkipDecision,
  transactionSummary,
  transactionLifecycleEvents,
} from "./observability.js";
import {
  type BotActions,
  type BotDecisionTranscript,
  type BuildTransactionResult,
} from "./runtime.js";

const noActions: BotActions = {
  collectedOrders: 0,
  completedDeposits: 0,
  matchedOrders: 0,
  deposits: 0,
  withdrawalRequests: 0,
  withdrawals: 0,
};

describe("bot observability", () => {
  it("emits one structured JSON-compatible event", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });

    const event = emitter.emit(7, "bot.decision.skipped", {
      reason: "no_actions",
      amount: 9007199254740993n,
      witnesses: ["0xabc"],
      witness: "0xabc",
      output_data: "0xabc",
      transactionShape: { witnesses: 1 },
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      env: "testnet",
    });

    expect(written).toHaveLength(1);
    expect(event).toBe(written[0]);
    expect(written[0]).toMatchObject({
      version: 1,
      app: "bot",
      chain: "testnet",
      runId: "run-1",
      iterationId: 7,
      type: "bot.decision.skipped",
      reason: "no_actions",
      amount: "9007199254740993",
      witnesses: ["0xabc"],
      witness: "0xabc",
      output_data: "0xabc",
      transactionShape: { witnesses: 1 },
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      env: "testnet",
    });
    expect(typeof (written[0] as { timestamp: unknown }).timestamp).toBe("string");
  });

  it("maps terminal lifecycle callbacks into confirmation and failure events", () => {
    expect(transactionLifecycleEvents({
      type: "timeout_after_broadcast",
      txHash: "0x01",
      status: "unknown",
      checks: 3,
      elapsedMs: 20,
    })).toEqual([
      {
        type: "bot.transaction.confirmation",
        fields: {
          txHash: "0x01",
          status: "unknown",
          checks: 3,
          elapsedMs: 20,
          outcome: "timeout_after_broadcast",
        },
      },
      {
        type: "bot.transaction.failed",
        fields: {
          txHash: "0x01",
          status: "unknown",
          checks: 3,
          elapsedMs: 20,
          outcome: "timeout_after_broadcast",
        },
      },
    ]);
  });

  it("summarizes transaction shape with the decision shape fields", () => {
    const tx = {
      inputs: [{}, {}],
      outputs: [{}],
      cellDeps: [{}, {}, {}],
      headerDeps: [{}],
      witnesses: [{}, {}],
    } as unknown as ccc.Transaction;

    expect(transactionSummary(tx, 4n, 5n)).toEqual({
      fee: 4n,
      feeRate: 5n,
      shape: {
        inputs: 2,
        outputs: 1,
        cellDeps: 3,
        headerDeps: 1,
        witnesses: 2,
      },
    });
  });

  it("preserves public chain tip block metadata", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });
    const blockHash = `0x${"11".repeat(32)}`;

    emitter.emit(1, "bot.state.read", {
      chainTip: {
        blockNumber: 123n,
        blockHash,
        timestamp: 456n,
      },
    });

    expect(written[0]).toMatchObject({
      chainTip: {
        blockNumber: "123",
        blockHash,
        timestamp: "456",
      },
    });
  });

  it("keeps stable event identity when payload fields collide", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });

    emitter.emit(7, "bot.decision.skipped", {
      version: 999,
      app: "wrong",
      chain: "mainnet",
      runId: "wrong",
      iterationId: 999,
      timestamp: "not-iso",
      type: "wrong",
    });

    expect(written[0]).toMatchObject({
      version: 1,
      app: "bot",
      chain: "testnet",
      runId: "run-1",
      iterationId: 7,
      type: "bot.decision.skipped",
    });
    expect((written[0] as { timestamp: string }).timestamp).not.toBe("not-iso");
  });

  it("preserves public error messages in structured error summaries", () => {
    const error = new Error("failed with witness 0x" + "22".repeat(80));

    const summary = errorSummary(error) as Record<string, unknown>;

    expect(summary.name).toBe("Error");
    expect(summary.message).toBe("failed with witness 0x" + "22".repeat(80));
    expect(summary.stack).toContain("failed with witness");
  });

  it("preserves nested error causes in structured error summaries", () => {
    const cause = new Error("inner public failure");
    const error = new Error("outer public failure", { cause });

    const summary = errorSummary(error) as Record<string, unknown>;

    expect(summary.cause).toMatchObject({
      name: "Error",
      message: "inner public failure",
    });
  });

  it("redacts runtime secrets in structured error summaries", () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const rpcUrl = "https://user:pass@testnet.example/rpc/path?token=secret";
    const cause = new Error(`inner ${privateKey} ${rpcUrl}`);
    const error = new Error(`outer ${privateKey} ${rpcUrl}`, { cause });
    error.stack = `outer stack ${privateKey} ${rpcUrl}`;
    cause.stack = `inner stack ${privateKey} ${rpcUrl}`;

    const summary = errorSummary(error, { privateKey, rpcUrl }) as Record<string, unknown>;
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("secret");
    expect(serialized).toContain("<redacted-private-key>");
    expect(serialized).toContain("https://redacted:redacted@testnet.example/...?token=redacted");
  });

  it("redacts runtime secrets in structured object error summaries", () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const rpcUrl = "https://user:pass@testnet.example/rpc/path?token=secret";

    const summary = errorSummary({
      message: `object ${privateKey}`,
      rpcUrl,
      amount: 9007199254740993n,
    }, { privateKey, rpcUrl }) as Record<string, unknown>;
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("secret");
    expect(serialized).toContain("<redacted-private-key>");
    expect(serialized).toContain("https://redacted:redacted@testnet.example/...?token=redacted");
  });

  it("redacts runtime secrets in transaction lifecycle errors", () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const rpcUrl = "https://user:pass@testnet.example/rpc/path?token=secret";
    const error = new Error(`lifecycle ${privateKey} ${rpcUrl}`);

    const events = transactionLifecycleEvents({
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error,
    }, { privateKey, rpcUrl });
    const serialized = JSON.stringify(events);

    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain("user:pass");
    expect(serialized).not.toContain("secret");
    expect(serialized).toContain("<redacted-private-key>");
    expect(serialized).toContain("https://redacted:redacted@testnet.example/...?token=redacted");
  });

  it("summarizes thrown objects with JSON-safe details", () => {
    const summary = errorSummary({
      code: "RPC_FAILURE",
      amount: 9007199254740993n,
      message: "failed with public evidence",
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      witnesses: ["0x" + "22".repeat(80)],
    }) as Record<string, unknown>;

    expect(summary).toEqual({
      message: "Non-Error object",
      details: {
        code: "RPC_FAILURE",
        amount: "9007199254740993",
        message: "failed with public evidence",
        lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
        witnesses: ["0x" + "22".repeat(80)],
      },
    });
  });

  it("emits a structured decision event for no-action skips", () => {
    const events: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        events.push(event);
      },
    });
    const actions = noActions;
    const decision: BotDecisionTranscript = {
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
        minimumCkbCapital: 0n,
      },
      orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
      withdrawals: { readyCount: 0, pendingCount: 0 },
      poolDeposits: { readyCount: 0, nearReadyCount: 0, futureCount: 0 },
      match: { partialCount: 0, ckbDelta: 0n, udtDelta: 0n },
      rebalance: {
        kind: "none",
        reason: "target_ickb_not_exceeded",
        diagnostics: {
          futurePool: {
            futureDepositCount: 2,
            canCreateFutureInventory: true,
            ringLength: 16n,
            segmentCount: 2,
            targetSegmentIndex: 0,
            targetSegmentLength: 8n,
            targetSegmentUdtValue: 2n,
            totalFutureUdt: 2n,
            anchorsShareOneSegment: true,
            segments: [
              { index: 0, length: 8n, depositCount: 2, udtValue: 2n, isTarget: true },
              { index: 1, length: 8n, depositCount: 0, udtValue: 0n, isTarget: false },
            ],
          },
        },
        outputSlots: 58,
        projectedAvailableCkb: 0n,
        projectedAvailableIckb: 0n,
      },
      actions,
      fee: { feeRate: 1n },
      transactionShape: { inputs: 0, outputs: 0, cellDeps: 0, headerDeps: 0, witnesses: 0 },
      exchangeRatio: { ckbScale: 1n, udtScale: 1n },
      depositCapacity: 0n,
      skip: { reason: "no_actions" },
    };
    const result: BuildTransactionResult = {
      kind: "skipped",
      reason: "no_actions",
      actions,
      decision,
    };

    emitDecisionEvents(emitter, 1, result);

    expect(events).toHaveLength(3);
    expect(events).toMatchObject([
      { type: "bot.match.evaluated" },
      { type: "bot.rebalance.evaluated" },
      {
        type: "bot.decision.skipped",
        reason: "no_actions",
        actions,
        decision: {
          rebalance: {
            kind: "none",
            reason: "target_ickb_not_exceeded",
            diagnostics: {
              futurePool: {
                futureDepositCount: 2,
                segments: [
                  { index: 0, length: "8", depositCount: 2, udtValue: "2", isTarget: true },
                  { index: 1, length: "8", depositCount: 0, udtValue: "0", isTarget: false },
                ],
              },
            },
          },
          skip: { reason: "no_actions" },
        },
      },
    ]);
  });

  it("keeps low-capital safety skips state-only", () => {
    const state = {
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
      },
      orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
      withdrawals: { readyCount: 0, pendingCount: 0 },
      poolDeposits: { readyCount: 0, nearReadyCount: 0, futureCount: 0 },
      exchangeRatio: { ckbScale: 1n, udtScale: 1n },
      depositCapacity: 0n,
    };

    const skip = lowCapitalSkipDecision(state);

    expect(skip).toEqual({
      reason: "capital_below_minimum",
      actions: noActions,
      state,
    });
    expect(skip).not.toHaveProperty("decision");
  });

});
