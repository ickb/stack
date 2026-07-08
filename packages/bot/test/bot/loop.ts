import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BotEventEmitter,
  completeTerminalIteration,
  reachedMaxRetryableAttempts,
  runBotLoop,
  type BotLoopContext,
  type BotLoopOperations,
} from "../../src/index.ts";
import type { BuildTransactionResult } from "../../src/runtime/types.ts";
import {
  noActionDecisionTranscript,
  noActions,
  record,
} from "../observability/fixtures/observability.ts";
import { botRuntime, botState } from "./fixtures/bot.ts";

const FETCH_FAILED = "fetch failed";
const DETERMINISTIC_BUILD_FAILURE = "deterministic build failure";
const CONFIRMATION_TIMED_OUT = "confirmation timed out";
const TRANSACTION_CONFIRMATION_ERROR = "TransactionConfirmationError";
const REJECTED_STATUS = "rejected";
const BOT_ITERATION_STARTED = "bot.iteration.started";
const BOT_STATE_READ = "bot.state.read";
const BOT_ITERATION_FAILED = "bot.iteration.failed";
const TX_HASH_AB = `0x${"ab".repeat(32)}` as const;
const TX_HASH_FF = `0x${"ff".repeat(32)}` as const;
const TIMEOUT_TX_HASH = `0x${"99".repeat(32)}` as const;
const RBF_REJECTED_REASON = JSON.stringify({
  type: "RBFRejected",
  description: `RBF rejected: replaced by tx Byte32(0x${"cd".repeat(32)})`,
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("completeTerminalIteration", () => {
  it("counts only terminal iterations toward bounded runs", () => {
    expect(completeTerminalIteration(0, 1)).toEqual({
      completedIterations: 1,
      shouldStop: true,
    });
    expect(completeTerminalIteration(0, 2)).toEqual({
      completedIterations: 1,
      shouldStop: false,
    });
    expect(completeTerminalIteration(999, undefined)).toEqual({
      completedIterations: 1000,
      shouldStop: false,
    });
  });
});

describe("reachedMaxRetryableAttempts", () => {
  it("uses a separate retryable-attempt budget", () => {
    expect(reachedMaxRetryableAttempts(1, 1)).toBe(true);
    expect(reachedMaxRetryableAttempts(1, 2)).toBe(false);
    expect(reachedMaxRetryableAttempts(999, undefined)).toBe(false);
  });
});

it("stops before building when total capital is below the minimum", async () => {
  const { context, events, logs, operations } = loopHarness({
    readBotState: async () => {
      await Promise.resolve();
      return botState({ minCkbBalance: 1n });
    },
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).not.toHaveBeenCalled();
  expect(operations.sleep).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(2);
  expect(eventTypes(events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.decision.skipped",
  ]);
  expect(events[2]).toMatchObject({
    reason: "capital_below_minimum",
    deficit: "1",
    actions: noActions,
  });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({
    error:
      "The bot must have more than 0.00000001 CKB worth of capital to be able to operate, shutting down...",
  });
});

it("low-capital stops do not consume bounded completed iterations", async () => {
  const { context, operations } = loopHarness({
    maxIterations: 1,
    readBotState: async () => {
      await Promise.resolve();
      return botState({ minCkbBalance: 1n });
    },
  });

  await runBotLoop(context);

  expect(operations.sleep).not.toHaveBeenCalled();
  expect(operations.buildTransaction).not.toHaveBeenCalled();
});

it("emits skipped decisions as completed bounded iterations", async () => {
  const result = skippedResult();
  const { context, events, logs, operations } = loopHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return result;
    },
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(operations.sendAndWaitForCommit).not.toHaveBeenCalled();
  expect(operations.sleep).not.toHaveBeenCalled();
  expect(eventTypes(events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.decision.skipped",
  ]);
  expect(logs[0]).toMatchObject({ actions: noActions });
});

it("sleeps between unbounded completed iterations", async () => {
  const results = [skippedResult(), skippedResult()];
  const { context, operations } = loopHarness({
    maxIterations: undefined,
    buildTransaction: async () => {
      await Promise.resolve();
      const result = results.shift();
      if (result === undefined) {
        return skippedResult();
      }
      return result;
    },
    sleep: async () => {
      await Promise.resolve();
      context.maxIterations = 2;
    },
    sleepInterval: asyncSleepInterval(123),
  });

  await runBotLoop(context);

  expect(operations.sleepInterval).toHaveBeenCalledWith(100);
  expect(operations.sleep).toHaveBeenCalledWith(123);
  expect(operations.buildTransaction).toHaveBeenCalledTimes(2);
});

it("sends built transactions and emits public lifecycle events", async () => {
  const tx = ccc.Transaction.from({
    outputs: [{ capacity: 0n, lock: emptyScript("22") }],
  });
  vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(7n);
  const { context, events, logs, operations } = loopHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    sendAndWaitForCommit: async (_runtime, _tx, options) => {
      await Promise.resolve();
      if (options === undefined) {
        throw new Error("Expected send options");
      }
      options.onSent?.(TX_HASH_AB);
      options.onLifecycle?.({
        type: "broadcasted",
        txHash: TX_HASH_AB,
        elapsedMs: 1,
      });
      options.onLifecycle?.({
        type: "committed",
        txHash: TX_HASH_AB,
        status: "committed",
        checks: 1,
        elapsedMs: 2,
      });
      return TX_HASH_AB;
    },
  });

  await runBotLoop(context);

  expect(operations.sendAndWaitForCommit).toHaveBeenCalledTimes(1);
  expect(eventTypes(events)).toEqual([
    BOT_ITERATION_STARTED,
    BOT_STATE_READ,
    "bot.match.evaluated",
    "bot.rebalance.evaluated",
    "bot.transaction.built",
    "bot.transaction.sent",
    "bot.transaction.confirmation",
    "bot.transaction.committed",
  ]);
  expect(events[5]).toMatchObject({
    txHash: TX_HASH_AB,
    transaction: {
      fee: "7",
      feeRate: "1",
      shape: { inputs: 0, outputs: 1, cellDeps: 0, headerDeps: 0, witnesses: 0 },
    },
  });
  expect(logs[0]).toMatchObject({
    txFee: { fee: "0.00000007", feeRate: 1n },
    txHash: TX_HASH_AB,
  });
  expect(operations.readBotState).toHaveBeenCalledTimes(1);
});

it("retries retryable failures without consuming bounded iterations", async () => {
  const attempts: Array<Error | BuildTransactionResult> = [
    new TypeError(FETCH_FAILED),
    new TypeError(FETCH_FAILED),
    skippedResult(),
  ];
  const { context, events, logs, operations } = loopHarness({
    maxIterations: 1,
    maxRetryableAttempts: 3,
    buildTransaction: async () => {
      await Promise.resolve();
      const next = attempts.shift();
      if (next instanceof Error) {
        throw next;
      }
      if (next === undefined) {
        throw new Error("Expected loop attempt fixture");
      }
      return next;
    },
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).toHaveBeenCalledTimes(3);
  expect(operations.sleep).toHaveBeenCalledTimes(2);
  expect(logs).toHaveLength(3);
  expect(
    events.filter((event) => record(event, "event")["type"] === BOT_ITERATION_FAILED),
  ).toMatchObject([
    {
      retryable: true,
      terminal: false,
      retryableAttempts: 1,
      maxRetryableAttempts: 3,
      retryBudgetExhausted: false,
    },
    {
      retryable: true,
      terminal: false,
      retryableAttempts: 2,
      maxRetryableAttempts: 3,
      retryBudgetExhausted: false,
    },
  ]);
});

it("stops after logging exhausted retryable failures", async () => {
  const { context, events, logs, operations } = loopHarness({
    maxRetryableAttempts: 1,
    buildTransaction: async () => {
      await Promise.resolve();
      throw new TypeError(FETCH_FAILED);
    },
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(operations.sleep).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(2);
  expect(events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: true,
    terminal: true,
    retryableAttempts: 1,
    maxRetryableAttempts: 1,
    retryBudgetExhausted: true,
  });
  expect(logs[0]).toMatchObject({
    error: {
      message: "Retryable bot error budget exhausted",
      attempts: 1,
      maxRetryableAttempts: 1,
      lastError: { name: "TypeError", message: FETCH_FAILED },
    },
  });
});

it("stops on non-retryable failures and records terminal metadata", async () => {
  const { context, events, logs, operations } = loopHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      throw new Error(DETERMINISTIC_BUILD_FAILURE);
    },
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).toHaveBeenCalledTimes(1);
  expect(operations.sleep).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
  expect(events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: false,
    terminal: true,
  });
  expect(logs[0]).toMatchObject({
    error: { name: "Error", message: DETERMINISTIC_BUILD_FAILURE },
  });
});

it("retries post-broadcast RBF confirmation rejections", async () => {
  const tx = ccc.Transaction.from({
    outputs: [{ capacity: 0n, lock: emptyScript("33") }],
  });
  const { context, events, logs, operations } = loopHarness({
    maxIterations: 1,
    buildTransaction: async () => {
      await Promise.resolve();
      return builtResult(tx);
    },
    sendAndWaitForCommit: vi
      .fn()
      .mockRejectedValueOnce(rbfConfirmationError())
      .mockResolvedValueOnce(TX_HASH_FF),
  });

  await runBotLoop(context);

  expect(operations.buildTransaction).toHaveBeenCalledTimes(2);
  expect(operations.sendAndWaitForCommit).toHaveBeenCalledTimes(2);
  expect(process.exitCode).toBeUndefined();
  expect(
    events.find((event) => record(event, "event")["type"] === BOT_ITERATION_FAILED),
  ).toMatchObject({
    retryable: true,
    terminal: false,
    error: {
      name: TRANSACTION_CONFIRMATION_ERROR,
      txHash: TX_HASH_AB,
      status: REJECTED_STATUS,
      isTimeout: false,
      reason: RBF_REJECTED_REASON,
    },
  });
  expect(logs[0]).toMatchObject({
    error: {
      name: "TransactionConfirmationError",
      txHash: TX_HASH_AB,
      status: REJECTED_STATUS,
      isTimeout: false,
      reason: RBF_REJECTED_REASON,
    },
  });
  expect(logs[1]).toMatchObject({ txHash: TX_HASH_FF });
});

it("preserves stop-worthy loop error exit codes", async () => {
  const timeout = Object.assign(new Error(CONFIRMATION_TIMED_OUT), {
    isTimeout: true,
    txHash: TIMEOUT_TX_HASH,
    status: "pending",
  });
  Object.defineProperty(timeout, "name", { value: "TransactionConfirmationError" });
  const { context, events, logs } = loopHarness({
    buildTransaction: async () => {
      await Promise.resolve();
      throw timeout;
    },
  });

  await runBotLoop(context);

  expect(process.exitCode).toBe(2);
  expect(events.at(-1)).toMatchObject({
    type: BOT_ITERATION_FAILED,
    retryable: false,
    terminal: true,
    error: {
      name: "TransactionConfirmationError",
      message: CONFIRMATION_TIMED_OUT,
      txHash: TIMEOUT_TX_HASH,
      status: "pending",
      isTimeout: true,
    },
  });
  expect(logs[0]).toMatchObject({
    error: {
      name: "TransactionConfirmationError",
      message: CONFIRMATION_TIMED_OUT,
      txHash: TIMEOUT_TX_HASH,
      status: "pending",
      isTimeout: true,
    },
  });
});

function eventTypes(events: unknown[]): string[] {
  return Array.from(events, (event) => String(record(event, "event")["type"]));
}

const defaultBuildTransaction: BotLoopOperations["buildTransaction"] = async () => {
  await Promise.resolve();
  return skippedResult();
};

function captureExecutionLog(
  logs: Array<Record<string, unknown>>,
): BotLoopOperations["logExecution"] {
  return (executionLog): void => {
    logs.push({ ...executionLog });
  };
}

const defaultReadBotState: BotLoopOperations["readBotState"] = async () => {
  await Promise.resolve();
  return botState({
    availableCkbBalance: 1n,
    totalCkbBalance: 1n,
    minCkbBalance: 0n,
  });
};

const defaultSendAndWaitForCommit: BotLoopOperations["sendAndWaitForCommit"] =
  async () => {
    await Promise.resolve();
    return TX_HASH_FF;
  };

const defaultSleep: BotLoopOperations["sleep"] = async () => {
  await Promise.resolve();
};

const defaultSleepInterval: BotLoopOperations["sleepInterval"] = () => 0;

function loopHarness(
  overrides: Partial<BotLoopOperations> & {
    maxIterations?: number;
    maxRetryableAttempts?: number;
  } = {},
): {
  context: BotLoopContext;
  events: unknown[];
  logs: Array<Record<string, unknown>>;
  operations: BotLoopOperations;
} {
  const { maxIterations, maxRetryableAttempts, ...operationOverrides } = overrides;
  const events: unknown[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const runtime = botRuntime();
  const operations: BotLoopOperations = {
    buildTransaction: vi.fn(
      operationOverrides.buildTransaction ?? defaultBuildTransaction,
    ),
    logExecution: vi.fn(operationOverrides.logExecution ?? captureExecutionLog(logs)),
    readBotState: vi.fn(operationOverrides.readBotState ?? defaultReadBotState),
    sendAndWaitForCommit: vi.fn(
      operationOverrides.sendAndWaitForCommit ?? defaultSendAndWaitForCommit,
    ),
    sleep: vi.fn(operationOverrides.sleep ?? defaultSleep),
    sleepInterval: vi.fn(operationOverrides.sleepInterval ?? defaultSleepInterval),
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
      sleepIntervalMs: 100,
      maxIterations: "maxIterations" in overrides ? maxIterations : 1,
      maxRetryableAttempts,
      operations,
    },
    events,
    logs,
    operations,
  };
}

function rbfConfirmationError(): Error {
  const error = Object.assign(new Error("Transaction ended with status: rejected"), {
    txHash: TX_HASH_AB,
    status: REJECTED_STATUS,
    isTimeout: false,
    reason: RBF_REJECTED_REASON,
  });
  Object.defineProperty(error, "name", { value: TRANSACTION_CONFIRMATION_ERROR });
  return error;
}

function asyncSleepInterval(value: number): BotLoopOperations["sleepInterval"] {
  return () => value;
}

function skippedResult(): BuildTransactionResult {
  return {
    kind: "skipped",
    reason: "no_actions",
    actions: noActions,
    decision: noActionDecisionTranscript(),
  };
}

function builtResult(tx: ccc.Transaction): BuildTransactionResult {
  return {
    kind: "built",
    tx,
    actions: { ...noActions, completedDeposits: 1 },
    decision: {
      ...noActionDecisionTranscript(),
      actions: { ...noActions, completedDeposits: 1 },
      transactionShape: {
        inputs: tx.inputs.length,
        outputs: tx.outputs.length,
        cellDeps: tx.cellDeps.length,
        headerDeps: tx.headerDeps.length,
        witnesses: tx.witnesses.length,
      },
    },
  };
}

function emptyScript(byte: string): ccc.ScriptLike {
  return { codeHash: `0x${byte.repeat(32)}`, hashType: "type", args: "0x" };
}
