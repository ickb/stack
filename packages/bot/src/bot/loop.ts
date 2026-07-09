import type { ccc } from "@ckb-ccc/core";
import {
  formatCkb,
  logExecution,
  randomSleepIntervalMs,
  reachedMaxIterations,
  sleep,
  STOP_EXIT_CODE,
} from "@ickb/node-utils";
import { sendAndWaitForCommit } from "@ickb/sdk";
import {
  emitDecisionEvents,
  lowCapitalSkipDecision,
  transactionSummary,
  type BotEventEmitter,
} from "../observability/events.ts";
import { transactionLifecycleEvents } from "../observability/lifecycle.ts";
import { summarizeBotState } from "../runtime/support.ts";
import { buildTransaction } from "../runtime/transaction.ts";
import type { BotState, BuildTransactionResult, Runtime } from "../runtime/types.ts";
import { handleIterationFailure, isRetryableBotError } from "./failure.ts";
import { readBotState } from "./state.ts";

type ExecutionLog = Record<string, unknown> & {
  startTime?: string;
  balance?: unknown;
  ratio?: unknown;
  error?: unknown;
  actions?: unknown;
  txFee?: unknown;
  txHash?: unknown;
};

type BuiltTransactionResult = Extract<BuildTransactionResult, { kind: "built" }>;
type BotStateDecision = ReturnType<typeof summarizeBotState>;
type IterationWorkStatus = "completed" | "stopped";

interface BotIterationResult {
  countsAsTerminalIteration: boolean;
  retryableAttempts: number;
  shouldStop: boolean;
}

export interface BotLoopOperations {
  buildTransaction: typeof buildTransaction;
  logExecution: typeof logExecution;
  readBotState: typeof readBotState;
  sendAndWaitForCommit: typeof sendAndWaitForCommit;
  sleep: typeof sleep;
  sleepInterval: typeof randomSleepIntervalMs;
}

export interface BotLoopContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, managers, and primary lock. */
  runtime: Runtime;

  /** Delay between loop iterations. */
  sleepIntervalMs: number;

  /** Optional maximum completed loop iterations. */
  maxIterations: number | undefined;

  /** Optional maximum retryable failures before stopping. */
  maxRetryableAttempts: number | undefined;

  /** Optional loop-owned effect overrides. Production callers use the defaults. */
  operations?: Partial<BotLoopOperations>;
}

const defaultBotLoopOperations: BotLoopOperations = {
  buildTransaction,
  logExecution,
  readBotState,
  sendAndWaitForCommit,
  sleep,
  sleepInterval: randomSleepIntervalMs,
};

export async function runBotLoop(context: BotLoopContext): Promise<void> {
  const operations = { ...defaultBotLoopOperations, ...context.operations };
  let completedIterations = 0;
  let retryableAttempts = 0;
  let iterationId = 0;
  for (;;) {
    iterationId += 1;
    const result = await runBotIteration(
      context,
      operations,
      iterationId,
      retryableAttempts,
    );
    retryableAttempts = result.retryableAttempts;
    if (result.countsAsTerminalIteration) {
      // Retryable failures do not consume bounded iterations; successful and
      // terminal non-retryable attempts reset the retry budget.
      retryableAttempts = 0;
      const completion = completeTerminalIteration(
        completedIterations,
        context.maxIterations,
      );
      completedIterations = completion.completedIterations;
      if (result.shouldStop || completion.shouldStop) {
        return;
      }
    }

    if (result.shouldStop) {
      return;
    }
    await operations.sleep(operations.sleepInterval(context.sleepIntervalMs));
  }
}

async function runBotIteration(
  context: BotLoopContext,
  operations: BotLoopOperations,
  iterationId: number,
  retryableAttempts: number,
): Promise<BotIterationResult> {
  const executionLog: ExecutionLog = {};
  const startTime = new Date();
  executionLog.startTime = startTime.toLocaleString();
  context.events.emit(iterationId, "bot.iteration.started");

  try {
    const status = await executeBotWork(context, operations, iterationId, executionLog);
    operations.logExecution(executionLog, startTime);
    return {
      countsAsTerminalIteration: status === "completed",
      retryableAttempts,
      shouldStop: status === "stopped",
    };
  } catch (error) {
    const failure = handleIterationFailure({
      context,
      iterationId,
      executionLog,
      error,
      retryableAttempts,
    });
    operations.logExecution(executionLog, startTime);
    return {
      countsAsTerminalIteration: !failure.retryableAttempt,
      retryableAttempts: failure.retryableAttempts,
      shouldStop: failure.stopAfterLog,
    };
  }
}

async function executeBotWork(
  context: BotLoopContext,
  operations: BotLoopOperations,
  iterationId: number,
  executionLog: ExecutionLog,
): Promise<IterationWorkStatus> {
  const state = await operations.readBotState(context.runtime);
  const stateDecision = summarizeBotState(state);
  emitBotStateRead(context.events, iterationId, stateDecision);
  recordExecutionState(executionLog, state, stateDecision);

  if (stateDecision.balances.totalEquivalentCkb <= state.minCkbBalance) {
    stopForLowCapital({
      events: context.events,
      iterationId,
      executionLog,
      state,
      stateDecision,
    });
    return "stopped";
  }

  const result = await operations.buildTransaction(context.runtime, state);
  await emitDecisionEvents(context.events, iterationId, result);
  Object.assign(executionLog, { actions: result.actions });
  if (result.kind === "built") {
    await sendBuiltTransaction({
      context,
      operations,
      iterationId,
      state,
      result,
      executionLog,
    });
  }
  return "completed";
}

function emitBotStateRead(
  events: BotEventEmitter,
  iterationId: number,
  stateDecision: BotStateDecision,
): void {
  events.emit(iterationId, "bot.state.read", {
    chainTip: stateDecision.chainTip,
    balances: stateDecision.balances,
    orders: stateDecision.orders,
    withdrawals: stateDecision.withdrawals,
    poolDeposits: stateDecision.poolDeposits,
    exchangeRatio: stateDecision.exchangeRatio,
    depositCapacity: stateDecision.depositCapacity,
    fee: stateDecision.fee,
  });
}

function recordExecutionState(
  executionLog: ExecutionLog,
  state: BotState,
  stateDecision: BotStateDecision,
): void {
  Object.assign(executionLog, {
    balance: {
      CKB: {
        total: formatCkb(state.totalCkbBalance),
        available: formatCkb(state.availableCkbBalance),
        unavailable: formatCkb(state.unavailableCkbBalance),
      },
      ICKB: {
        total: formatCkb(state.availableIckbBalance),
        available: formatCkb(state.availableIckbBalance),
        unavailable: formatCkb(0n),
      },
      totalEquivalent: {
        CKB: formatCkb(stateDecision.balances.totalEquivalentCkb),
        ICKB: formatCkb(stateDecision.balances.totalEquivalentIckb),
      },
    },
    ratio: state.system.exchangeRatio,
  });
}

function stopForLowCapital({
  events,
  iterationId,
  executionLog,
  state,
  stateDecision,
}: {
  events: BotEventEmitter;
  iterationId: number;
  executionLog: ExecutionLog;
  state: BotState;
  stateDecision: BotStateDecision;
}): void {
  const skip = lowCapitalSkipDecision(stateDecision);
  events.emit(iterationId, "bot.decision.skipped", skip);
  Object.assign(executionLog, {
    error: `The bot must have more than ${formatCkb(
      state.minCkbBalance,
    )} CKB worth of capital to be able to operate, shutting down...`,
  });
  process.exitCode = STOP_EXIT_CODE;
}

async function sendBuiltTransaction({
  context,
  operations,
  iterationId,
  state,
  result,
  executionLog,
}: {
  context: BotLoopContext;
  operations: BotLoopOperations;
  iterationId: number;
  state: BotState;
  result: BuiltTransactionResult;
  executionLog: ExecutionLog;
}): Promise<void> {
  const fee = result.tx.estimateFee(state.system.feeRate);
  Object.assign(executionLog, {
    txFee: {
      fee: formatCkb(fee),
      feeRate: state.system.feeRate,
    },
  });
  const txHash = await operations.sendAndWaitForCommit(context.runtime, result.tx, {
    onSent: (sentTxHash) => {
      Object.assign(executionLog, { txHash: sentTxHash });
    },
    onLifecycle: emitTransactionLifecycle({
      events: context.events,
      iterationId,
      tx: result.tx,
      fee,
      feeRate: state.system.feeRate,
    }),
  });
  Object.assign(executionLog, { txHash });
}

function emitTransactionLifecycle({
  events,
  iterationId,
  tx,
  fee,
  feeRate,
}: {
  events: BotEventEmitter;
  iterationId: number;
  tx: ccc.Transaction;
  fee: bigint;
  feeRate: ccc.Num;
}): (event: Parameters<typeof transactionLifecycleEvents>[0]) => void {
  return (event) => {
    for (const lifecycle of transactionLifecycleEvents(event, isRetryableBotError)) {
      events.emit(iterationId, lifecycle.type, {
        ...lifecycle.fields,
        ...(event.type === "broadcasted"
          ? { transaction: transactionSummary(tx, fee, feeRate) }
          : {}),
      });
    }
  };
}

/**
 * Counts one terminal loop iteration and reports whether the configured iteration limit has been reached.
 */
export function completeTerminalIteration(
  completedIterations: number,
  maxIterations: number | undefined,
): { completedIterations: number; shouldStop: boolean } {
  const nextCompletedIterations = completedIterations + 1;
  return {
    completedIterations: nextCompletedIterations,
    shouldStop: reachedMaxIterations(nextCompletedIterations, maxIterations),
  };
}
