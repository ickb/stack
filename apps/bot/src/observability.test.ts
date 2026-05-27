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
  it("keeps stack traces by default but can summarize retryable errors", () => {
    const error = new Error("scan raced chain tip");
    const summary = errorSummary(error);

    expect(summary).toMatchObject({
      name: "Error",
      message: "scan raced chain tip",
    });
    expect(typeof summary).toBe("object");
    expect(summary).not.toBeNull();
    expect((summary as Record<string, unknown>)["stack"]).toContain("scan raced chain tip");
    expect(errorSummary(error, { includeStack: false })).toEqual({
      name: "Error",
      message: "scan raced chain tip",
    });
  });

  it("preserves public CKB RPC error fields from Error objects", () => {
    const rbfError = Object.assign(new Error("Client request error PoolRejectedRBF"), {
      code: -1111,
      data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
      currentFee: 11795n,
      leastFee: 12326n,
    });
    const resolveError = Object.assign(new Error("Client request error TransactionFailedToResolve"), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: {
        txHash: `0x${"11".repeat(32)}`,
        index: 0n,
      },
    });

    expect(errorSummary(rbfError, { includeStack: false })).toEqual({
      name: "Error",
      message: "Client request error PoolRejectedRBF",
      code: -1111,
      data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
      currentFee: "11795",
      leastFee: "12326",
    });
    expect(errorSummary(resolveError, { includeStack: false })).toEqual({
      name: "Error",
      message: "Client request error TransactionFailedToResolve",
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
      outPoint: {
        txHash: `0x${"11".repeat(32)}`,
        index: "0",
      },
    });
  });

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
      witnesses: ["0x" + "11".repeat(80)],
      witness: "0x" + "22".repeat(80),
      output_data: "0x" + "33".repeat(80),
      transactionShape: { witnesses: 1 },
      txHash: `0x${"44".repeat(32)}`,
      tx: { inputs: [], outputs: [], witnesses: [] },
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      cell: { cellOutput: { lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" } } },
      env: "testnet",
      environment: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
      config: { chain: "testnet" },
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
      witnesses: ["0x" + "11".repeat(80)],
      witness: "0x" + "22".repeat(80),
      output_data: "0x" + "33".repeat(80),
      transactionShape: { witnesses: 1 },
      tx: { inputs: [], outputs: [], witnesses: [] },
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      cell: { cellOutput: { lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" } } },
      env: "testnet",
      environment: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
      config: { chain: "testnet" },
    });
    expect((written[0] as Record<string, unknown>).txHash).toBe(`0x${"44".repeat(32)}`);
    expect(typeof (written[0] as { timestamp: unknown }).timestamp).toBe("string");
  });

  it("emits functions and circular values as JSON-safe fields", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });
    const circular: Record<string, unknown> = { label: "root" };
    circular.self = circular;

    emitter.emit(7, "bot.decision.skipped", {
      evidence: {
        toJSON: (): Record<string, string> => ({ ignored: "custom serializer" }),
        circular,
      },
    });

    expect(written[0]).toMatchObject({
      evidence: {
        toJSON: "[Unsupported log value]",
        circular: { label: "root", self: "[Circular]" },
      },
    });
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
          phase: "confirmation",
          status: "unknown",
          checks: 3,
          elapsedMs: 20,
          outcome: "timeout_after_broadcast",
          retryable: false,
          terminal: true,
        },
      },
      {
        type: "bot.transaction.failed",
        fields: {
          txHash: "0x01",
          phase: "confirmation",
          status: "unknown",
          checks: 3,
          elapsedMs: 20,
          outcome: "timeout_after_broadcast",
          retryable: false,
          terminal: true,
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

  it("emits public chain preflight evidence", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });
    const genesisHash = `0x${"11".repeat(32)}`;
    const tipHash = `0x${"22".repeat(32)}`;

    emitter.emit(0, "bot.chain.preflight", {
      rpcConfigured: true,
      expected: {
        chain: "testnet",
        networkName: "ckb_testnet",
        genesisHash,
        genesisMessage: "aggron-v4",
        genesisSource: "test fixture",
        addressPrefix: "ckt",
      },
      observed: {
        genesisHash,
        addressPrefix: "ckt",
        tip: {
          hash: tipHash,
          number: 123n,
          timestamp: 456n,
        },
      },
      matches: {
        genesisHash: true,
        addressPrefix: true,
      },
    });

    expect(written[0]).toMatchObject({
      type: "bot.chain.preflight",
      rpcConfigured: true,
      expected: { chain: "testnet", genesisHash, addressPrefix: "ckt" },
      observed: {
        genesisHash,
        addressPrefix: "ckt",
        tip: { hash: tipHash, number: "123", timestamp: "456" },
      },
      matches: { genesisHash: true, addressPrefix: true },
    });
  });

  it("emits run context without private key material", () => {
    const written: unknown[] = [];
    const emitter = new BotEventEmitter({
      chain: "testnet",
      runId: "run-1",
      write: (event): void => {
        written.push(event);
      },
    });

    emitter.emit(0, "bot.run.started", {
      maxIterations: 1,
      bounded: true,
      runtime: {
        maxIterations: 1,
        bounded: true,
        sleepIntervalMs: 60000,
        rpcConfigured: true,
      },
      config: { chain: "testnet" },
      rpcHost: "testnet.example",
    });

    expect(written[0]).toMatchObject({
      type: "bot.run.started",
      maxIterations: 1,
      bounded: true,
      runtime: {
        maxIterations: 1,
        bounded: true,
        sleepIntervalMs: 60000,
        rpcConfigured: true,
      },
      config: { chain: "testnet" },
      rpcHost: "testnet.example",
    });
  });

  it("preserves transaction-shaped error messages in structured error summaries", () => {
    const error = new Error("failed with witness 0x" + "22".repeat(80));

    const summary = errorSummary(error) as Record<string, unknown>;

    expect(summary.name).toBe("Error");
    expect(summary.message).toBe("failed with witness 0x" + "22".repeat(80));
    expect(summary.stack).toContain("failed with witness");
  });

  it("preserves serialized transaction-shaped error messages", () => {
    const error = new Error(`failed {"witnesses":["0x${"22".repeat(80)}"],"inputs":[]}`);

    const summary = errorSummary(error) as Record<string, unknown>;

    expect(summary.message).toBe(`failed {"witnesses":["0x${"22".repeat(80)}"],"inputs":[]}`);
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

  it("preserves public RPC debugging data in structured object error summaries", () => {
    const rpcUrl = "https://testnet.example/rpc/path";

    const summary = errorSummary({
      message: `object ${rpcUrl}`,
      rpcUrl,
      amount: 9007199254740993n,
    }) as Record<string, unknown>;
    const serialized = JSON.stringify(summary);

    expect(serialized).toContain(rpcUrl);
    expect((summary.details as Record<string, unknown>).rpcUrl).toBe(rpcUrl);
  });

  it("preserves public nested object error fields", () => {
    const rpcUrl = "https://testnet.example/rpc/path";

    const summary = errorSummary({
      message: `failed ${rpcUrl}`,
      nested: {
        publicReason: "visible evidence",
      },
    }) as Record<string, unknown>;
    const details = summary.details as Record<string, unknown>;
    const nested = details.nested as Record<string, unknown>;

    expect(details.message).toBe(`failed ${rpcUrl}`);
    expect(nested.publicReason).toBe("visible evidence");
  });

  it("marks pre-broadcast transport and CKB state-race failures retryable", () => {
    const transportEvents = transactionLifecycleEvents({
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error: new TypeError("fetch failed"),
    });
    const rbfEvents = transactionLifecycleEvents({
      type: "pre_broadcast_failed",
      elapsedMs: 12,
      error: Object.assign(new Error("Client request error PoolRejectedRBF"), {
        code: -1111,
        data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
        currentFee: 11795n,
        leastFee: 12326n,
      }),
    });

    expect(transportEvents).toMatchObject([{
      type: "bot.transaction.failed",
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: true,
        terminal: false,
      },
    }]);
    expect(transportEvents[0]?.fields.error).not.toHaveProperty("stack");
    expect(rbfEvents).toMatchObject([{
      type: "bot.transaction.failed",
      fields: {
        phase: "pre_broadcast",
        outcome: "pre_broadcast_failed",
        retryable: true,
        terminal: false,
        error: {
          code: -1111,
          data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
          currentFee: "11795",
          leastFee: "12326",
        },
      },
    }]);
    expect(rbfEvents[0]?.fields.error).not.toHaveProperty("stack");
  });

  it("summarizes thrown objects with JSON-safe debugging details preserved", () => {
    const summary = errorSummary({
      code: "RPC_FAILURE",
      amount: 9007199254740993n,
      message: "failed with public evidence",
      lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
      cell: { cellOutput: { lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" } } },
      witnesses: ["0x" + "22".repeat(80)],
      signedTx: "0x" + "33".repeat(80),
      env: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
      config: { chain: "testnet" },
    }) as Record<string, unknown>;

    expect(summary).toEqual({
      message: "Non-Error object",
      details: {
        code: "RPC_FAILURE",
        amount: "9007199254740993",
        message: "failed with public evidence",
        lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" },
        cell: { cellOutput: { lock: { codeHash: "0xabc", hashType: "type", args: "0xdef" } } },
        witnesses: ["0x" + "22".repeat(80)],
        signedTx: "0x" + "33".repeat(80),
        env: { BOT_CONFIG_FILE: "/run/credentials/config.json" },
        config: { chain: "testnet" },
      },
    });
  });

  it("preserves transaction-shaped details from nested object causes", () => {
    const summary = errorSummary(new Error("outer", {
      cause: {
        message: "inner public evidence",
        inputs: [{}],
        outputsData: ["0x" + "22".repeat(80)],
        cellDeps: [{}],
        headerDeps: [{}],
      },
    })) as Record<string, unknown>;

    expect(summary.cause).toEqual({
      message: "Non-Error object",
      details: {
        message: "inner public evidence",
        inputs: [{}],
        outputsData: ["0x" + "22".repeat(80)],
        cellDeps: [{}],
        headerDeps: [{}],
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
        spendableCkb: 0n,
      },
      orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
      withdrawals: { readyCount: 0, pendingCount: 0 },
      poolDeposits: { readyCount: 0, nearReadyCount: 0, futureCount: 0 },
      match: { reason: "no_market_orders", partialCount: 0, ckbDelta: 0n, udtDelta: 0n },
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
        spendableCkb: 0n,
      },
      orders: { marketCount: 0, userCount: 0, receiptCount: 0 },
      withdrawals: { readyCount: 0, pendingCount: 0 },
      poolDeposits: { readyCount: 0, nearReadyCount: 0, futureCount: 0 },
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
