import { ccc } from "@ckb-ccc/core";
import { STOP_EXIT_CODE } from "@ickb/node-utils";
import { TransactionBroadcastError, TransactionWaitError } from "@ickb/sdk";
import { afterEach, expect, it, vi } from "vitest";
import {
  BOT_TRANSACTION_WAIT_INTERVAL_MS,
  BOT_TRANSACTION_WAIT_TIMEOUT_MS,
  runBotTurn,
  type BotTurnContext,
  type BotTurnOperations,
} from "../../src/bot/turn.ts";
import { BotEventEmitter } from "../../src/observability/events.ts";
import type { BuildTransactionResult, Runtime } from "../../src/runtime/types.ts";
import {
  noActionDecisionTranscript,
  noActions,
} from "../observability/fixtures/observability.ts";
import { botRuntime, botState, hash } from "./fixtures/bot.ts";

const TX_HASH = hash("ab");
const BOT_ITERATION_STARTED = "bot.iteration.started";
const BOT_STATE_READ = "bot.state.read";
const BOT_ITERATION_FAILED = "bot.iteration.failed";
const BOT_TRANSACTION_SENT = "bot.transaction.sent";
const BOT_TRANSACTION_CONFIRMATION = "bot.transaction.confirmation";
const BOT_TRANSACTION_COMMITTED = "bot.transaction.committed";
const BOT_TRANSACTION_FAILED = "bot.transaction.failed";
const FETCH_FAILED = "fetch failed";
const RBF_REJECTED_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"22".repeat(32)})`,
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it("stops with event-only low-capital evidence", async () => {
  const harness = turnHarness({
    readBotState: async () => {
      await Promise.resolve();
      return botState({ minCkbBalance: 1n });
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(2);
  expect(eventTypes(harness.events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.decision.skipped",
  ]);
  expect(harness.events.at(-1)).toMatchObject({
    reason: "capital_below_minimum",
    deficit: "1",
    actions: noActions,
  });
  expect(harness.operations.buildTransaction).not.toHaveBeenCalled();
});

it("records skipped terminal iterations without legacy execution logs", async () => {
  const harness = turnHarness();

  await runBotTurn(harness.context);

  expect(eventTypes(harness.events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.decision.skipped",
  ]);
  expect(harness.operations.waitTransaction).not.toHaveBeenCalled();
});

it("sends explicitly and waits with the finite production policy", async () => {
  const tx = ccc.Transaction.from({
    outputs: [{ capacity: 0n, lock: emptyScript("22") }],
  });
  vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(7n);
  const sendTransaction = vi.fn<Runtime["sendTransaction"]>(async () => {
    await Promise.resolve();
    return TX_HASH;
  });
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    sendTransaction,
  });

  await runBotTurn(harness.context);

  const recordTxHash = sendTransaction.mock.calls[0]?.[1];
  expect(typeof recordTxHash).toBe("function");
  expect(harness.operations.waitTransaction).toHaveBeenCalledWith(
    harness.context.runtime.client,
    TX_HASH,
    {
      timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
      interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
    },
  );
  expect(eventTypes(harness.events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.transaction.built",
    BOT_TRANSACTION_SENT,
    BOT_TRANSACTION_CONFIRMATION,
    BOT_TRANSACTION_COMMITTED,
  ]);
  expect(harness.events[5]).toMatchObject({
    txHash: TX_HASH,
    transaction: { fee: "7", feeRate: "1" },
  });
});

it("reports broadcast failures with send-phase evidence", async () => {
  const tx = ccc.Transaction.default();
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    sendTransaction: async () => {
      await Promise.resolve();
      throw new Error("transaction broadcast failed");
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_FAILED),
  ).toMatchObject({
    phase: "broadcast",
    outcome: "send_failed",
    retryable: false,
    terminal: true,
    error: { message: "transaction broadcast failed" },
  });
});

it("confirms the recorded hash after an ambiguous send without rebuilding", async () => {
  const tx = ccc.Transaction.default();
  const sendTransaction = vi.fn<Runtime["sendTransaction"]>(async (_tx, recordTxHash) => {
    await Promise.resolve();
    recordTxHash?.(TX_HASH);
    throw new TransactionBroadcastError(TX_HASH, {
      cause: new TypeError(FETCH_FAILED),
    });
  });
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    sendTransaction,
  });

  await runBotTurn(harness.context);

  expect(sendTransaction).toHaveBeenCalledTimes(1);
  expect(harness.operations.waitTransaction).toHaveBeenCalledWith(
    harness.context.runtime.client,
    TX_HASH,
    {
      timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
      interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
    },
  );
  expect(harness.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: BOT_TRANSACTION_SENT,
        txHash: TX_HASH,
        outcome: "broadcast_ambiguous",
      }),
      expect.objectContaining({
        type: BOT_TRANSACTION_COMMITTED,
        txHash: TX_HASH,
      }),
    ]),
  );
});

it("falls back to the broadcast error hash when no hash was recorded", async () => {
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(ccc.Transaction.default());
    },
    sendTransaction: async () => {
      await Promise.resolve();
      throw new TransactionBroadcastError(TX_HASH, {
        cause: new TypeError(FETCH_FAILED),
      });
    },
  });

  await runBotTurn(harness.context);

  expect(harness.operations.waitTransaction).toHaveBeenCalledWith(
    harness.context.runtime.client,
    TX_HASH,
    {
      timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
      interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
    },
  );
  expect(harness.events).toContainEqual(
    expect.objectContaining({
      type: BOT_TRANSACTION_SENT,
      txHash: TX_HASH,
      outcome: "broadcast_ambiguous",
    }),
  );
});

it("fails closed on a node hash mismatch without waiting or retrying its cause", async () => {
  const nodeTxHash = hash("ac");
  const sendTransaction = vi.fn<Runtime["sendTransaction"]>(async (_tx, recordTxHash) => {
    await Promise.resolve();
    recordTxHash?.(TX_HASH);
    throw new TransactionBroadcastError(TX_HASH, {
      nodeTxHash,
      cause: new TypeError(FETCH_FAILED),
    });
  });
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(ccc.Transaction.default());
    },
    sendTransaction,
  });

  await runBotTurn(harness.context);

  // The node answered about a transaction this attempt cannot bind, so the local
  // one may already be accepted and a restart could resend it.
  expect(process.exitCode).toBe(STOP_EXIT_CODE);
  expect(sendTransaction).toHaveBeenCalledTimes(1);
  expect(harness.operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(harness.operations.waitTransaction).not.toHaveBeenCalled();
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_FAILED),
  ).toMatchObject({
    txHash: TX_HASH,
    nodeTxHash,
    phase: "broadcast",
    outcome: "send_failed",
    retryable: false,
    terminal: true,
    error: { txHash: TX_HASH, nodeTxHash },
  });
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: false,
    terminal: true,
    error: { txHash: TX_HASH, nodeTxHash },
  });
});

it("normalizes confirmation error fields from public errors", async () => {
  const tx = ccc.Transaction.default();
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    waitTransaction: async () => {
      await Promise.resolve();
      throw Object.assign(new Error("transaction confirmation failed"), {
        reason: "node rejected transaction",
        status: 503,
      });
    },
  });

  await runBotTurn(harness.context);

  // A broadcast transaction with an unresolved outcome must not be resent.
  expect(process.exitCode).toBe(2);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject({
    txHash: TX_HASH,
    outcome: "confirmation_failed",
    status: "unresolved",
    reason: "node rejected transaction",
    isTimeout: false,
    retryable: false,
    terminal: true,
  });
});

// Only an RBF replacement leaves the sent transaction permanently unconfirmable, so
// only it may hand the next turn a rebuild (exit 1); any other rejection holds (exit 2).
it.each([
  { reason: RBF_REJECTED_REASON, expectedExitCode: 1 },
  { reason: "Resolve failed Dead(OutPoint(...))", expectedExitCode: 2 },
])(
  "exits for the next turn only after RBF rejection: $reason",
  async ({ reason, expectedExitCode }) => {
    const harness = turnHarness({
      buildTransaction: async () => {
        await Promise.resolve();
        return builtResult(ccc.Transaction.default());
      },
      waitTransaction: async () => {
        await Promise.resolve();
        throw new TransactionWaitError(TX_HASH, { status: "rejected", reason });
      },
    });

    await runBotTurn(harness.context);

    expect(harness.operations.buildTransaction).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(expectedExitCode);
  },
);

it("tolerates confirmation fields disappearing during inspection", async () => {
  let statusChecks = 0;
  const error = new Proxy(
    Object.assign(new Error("transaction confirmation failed"), {
      status: "rejected",
    }),
    {
      has: (target, property): boolean => {
        if (property === "status") {
          statusChecks += 1;
          return statusChecks === 1;
        }
        return Reflect.has(target, property);
      },
    },
  );
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(ccc.Transaction.default());
    },
    waitTransaction: async () => {
      await Promise.resolve();
      throw error;
    },
  });

  await runBotTurn(harness.context);

  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject({ status: "unresolved" });
});

it("ends the attempt after one confirmation window without resending or rebuilding", async () => {
  const tx = ccc.Transaction.default();
  const timeout = new ccc.ErrorClientWaitTransactionTimeout(
    BOT_TRANSACTION_WAIT_TIMEOUT_MS,
  );
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    waitTransaction: vi.fn().mockRejectedValue(timeout),
    sendTransaction: vi.fn(async () => {
      await Promise.resolve();
      return TX_HASH;
    }),
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(2);
  expect(harness.context.runtime.sendTransaction).toHaveBeenCalledTimes(1);
  expect(harness.operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(harness.operations.waitTransaction).toHaveBeenCalledTimes(1);
  const timeoutFailure = {
    txHash: TX_HASH,
    outcome: "timeout",
    isTimeout: true,
    retryable: false,
    terminal: true,
  };
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_CONFIRMATION),
  ).toMatchObject(timeoutFailure);
  expect(
    harness.events.find((event) => event.type === BOT_TRANSACTION_FAILED),
  ).toMatchObject(timeoutFailure);
  expect(
    harness.events.filter((event) => event.type === BOT_TRANSACTION_COMMITTED),
  ).toHaveLength(0);
});

it("exits 1 with retryable metadata so the next turn can retry", async () => {
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED);
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(harness.operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: true,
    terminal: false,
    error: { name: "TypeError", message: FETCH_FAILED },
  });
  expect(harness.events.at(-1)?.["error"]).not.toHaveProperty("stack");
});

it("stops non-retryable failures with structured event evidence", async () => {
  const harness = turnHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      throw new Error("deterministic build failure");
    },
  });

  await runBotTurn(harness.context);

  expect(process.exitCode).toBe(1);
  expect(harness.events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: false,
    terminal: true,
    error: { message: "deterministic build failure" },
  });
});

function turnHarness(
  overrides: Partial<BotTurnOperations> & {
    sendTransaction?: Runtime["sendTransaction"];
  } = {},
): {
  context: BotTurnContext;
  events: Array<Record<string, unknown> & { type: string }>;
  operations: BotTurnOperations;
} {
  const { sendTransaction, ...operationOverrides } = overrides;
  const events: Array<Record<string, unknown> & { type: string }> = [];
  const runtime = botRuntime();
  runtime.sendTransaction =
    sendTransaction ??
    (async (): Promise<ccc.Hex> => {
      await Promise.resolve();
      return TX_HASH;
    });
  const operations: BotTurnOperations = {
    buildTransaction: vi.fn(operationOverrides.buildTransaction ?? defaultBuild),
    readBotState: vi.fn(operationOverrides.readBotState ?? defaultReadState),
    waitTransaction: vi.fn(operationOverrides.waitTransaction ?? asyncCommitted),
  };
  return {
    context: {
      events: new BotEventEmitter({
        chain: "testnet",
        runId: "run-1",
        write: (event): void => {
          events.push(event);
        },
      }),
      runtime,
      operations,
    },
    events,
    operations,
  };
}

async function defaultBuild(): Promise<ReturnType<typeof skippedResult>> {
  await Promise.resolve();
  return skippedResult();
}

async function defaultReadState(): Promise<ReturnType<typeof botState>> {
  await Promise.resolve();
  return botState({ availableCkbBalance: 1n, totalCkbBalance: 1n });
}

async function asyncCommitted(): Promise<ccc.ClientTransactionResponse> {
  await Promise.resolve();
  return new ccc.ClientTransactionResponse(
    ccc.Transaction.default(),
    "committed",
    undefined,
    hash("cd"),
    10n,
  );
}

function skippedResult(): BuildTransactionResult {
  return {
    kind: "skipped" as const,
    reason: "no_actions" as const,
    actions: noActions,
    decision: noActionDecisionTranscript(),
  };
}

function builtResult(tx: ccc.Transaction): BuildTransactionResult {
  return {
    kind: "built" as const,
    tx,
    actions: { ...noActions, completedDeposits: 1 },
    decision: {
      ...noActionDecisionTranscript(),
      actions: { ...noActions, completedDeposits: 1 },
    },
  };
}

function eventTypes(events: Array<{ type: string }>): string[] {
  return events.map((event) => event.type);
}

function emptyScript(byte: string): ccc.ScriptLike {
  return { codeHash: hash(byte), hashType: "type", args: "0x" };
}
