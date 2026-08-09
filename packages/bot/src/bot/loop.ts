import { ccc } from "@ckb-ccc/core";
import {
  randomSleepIntervalMs,
  reachedMaxIterations,
  sleep,
  STOP_EXIT_CODE,
} from "@ickb/node-utils";
import {
  TransactionBroadcastError,
  TransactionWaitError,
  waitTransaction,
} from "@ickb/sdk";
import { errorSummary } from "../observability/error.ts";
import {
  emitDecisionEvents,
  lowCapitalSkipDecision,
  transactionSummary,
  type BotEventEmitter,
} from "../observability/events.ts";
import { summarizeBotState } from "../runtime/support.ts";
import { buildTransaction } from "../runtime/transaction.ts";
import type { BotState, BuildTransactionResult, Runtime } from "../runtime/types.ts";
import { handleIterationFailure, isRetryableBotError } from "./failure.ts";
import { readBotState } from "./state.ts";

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
  readBotState: typeof readBotState;
  sleep: typeof sleep;
  sleepInterval: typeof randomSleepIntervalMs;
  waitTransaction: typeof waitTransaction;
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
  readBotState,
  sleep,
  sleepInterval: randomSleepIntervalMs,
  waitTransaction,
};

export const BOT_TRANSACTION_WAIT_TIMEOUT_MS = 600_000;
export const BOT_TRANSACTION_WAIT_INTERVAL_MS = 10_000;

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
      completedIterations += 1;
      if (
        result.shouldStop ||
        reachedMaxIterations(completedIterations, context.maxIterations)
      ) {
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
  context.events.emit(iterationId, "bot.iteration.started");

  try {
    const status = await executeBotWork(context, operations, iterationId);
    return {
      countsAsTerminalIteration: status === "completed",
      retryableAttempts,
      shouldStop: status === "stopped",
    };
  } catch (error) {
    const failure = handleIterationFailure({
      context,
      iterationId,
      error,
      retryableAttempts,
    });
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
): Promise<IterationWorkStatus> {
  const state = await operations.readBotState(context.runtime);
  const stateDecision = summarizeBotState(state);
  emitBotStateRead(context.events, iterationId, stateDecision);

  if (stateDecision.balances.totalEquivalentCkb <= state.minCkbBalance) {
    stopForLowCapital({
      events: context.events,
      iterationId,
      stateDecision,
    });
    return "stopped";
  }

  const result = await operations.buildTransaction(context.runtime, state);
  await emitDecisionEvents(context.events, iterationId, result);
  if (result.kind === "built") {
    await sendBuiltTransaction({
      context,
      operations,
      iterationId,
      state,
      result,
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

function stopForLowCapital({
  events,
  iterationId,
  stateDecision,
}: {
  events: BotEventEmitter;
  iterationId: number;
  stateDecision: BotStateDecision;
}): void {
  const skip = lowCapitalSkipDecision(stateDecision);
  events.emit(iterationId, "bot.decision.skipped", skip);
  process.exitCode = STOP_EXIT_CODE;
}

async function sendBuiltTransaction({
  context,
  operations,
  iterationId,
  state,
  result,
}: {
  context: BotLoopContext;
  operations: BotLoopOperations;
  iterationId: number;
  state: BotState;
  result: BuiltTransactionResult;
}): Promise<void> {
  const fee = result.tx.estimateFee(state.system.feeRate);
  const startedAt = Date.now();
  const txHash = await broadcastTransaction({
    context,
    iterationId,
    result,
    fee,
    feeRate: state.system.feeRate,
    startedAt,
  });
  await confirmTransaction({ context, operations, iterationId, txHash, startedAt });
}

async function broadcastTransaction({
  context,
  iterationId,
  result,
  fee,
  feeRate,
  startedAt,
}: {
  context: BotLoopContext;
  iterationId: number;
  result: BuiltTransactionResult;
  fee: bigint;
  feeRate: ccc.Num;
  startedAt: number;
}): Promise<ccc.Hex> {
  let recordedHash: ccc.Hex | undefined;
  try {
    const txHash = await context.runtime.sendTransaction(result.tx, (hash) => {
      recordedHash = hash;
    });
    context.events.emit(iterationId, "bot.transaction.sent", {
      txHash,
      phase: "broadcast",
      outcome: "broadcasted",
      elapsedMs: Date.now() - startedAt,
      transaction: transactionSummary(result.tx, fee, feeRate),
    });
    return txHash;
  } catch (error) {
    if (error instanceof TransactionBroadcastError && error.nodeTxHash === undefined) {
      const txHash = recordedHash ?? error.txHash;
      context.events.emit(iterationId, "bot.transaction.sent", {
        txHash,
        phase: "broadcast",
        outcome: "broadcast_ambiguous",
        elapsedMs: Date.now() - startedAt,
        transaction: transactionSummary(result.tx, fee, feeRate),
        error: errorSummary(error, { includeStack: false }),
      });
      return txHash;
    }
    const hashMismatch =
      error instanceof TransactionBroadcastError && error.nodeTxHash !== undefined;
    const retryable = isRetryableBotError(error);
    context.events.emit(iterationId, "bot.transaction.failed", {
      ...(hashMismatch ? { txHash: error.txHash, nodeTxHash: error.nodeTxHash } : {}),
      phase: "broadcast",
      outcome: "send_failed",
      retryable,
      terminal: !retryable,
      elapsedMs: Date.now() - startedAt,
      error: errorSummary(error, { includeStack: !retryable }),
    });
    throw error;
  }
}

async function confirmTransaction({
  context,
  operations,
  iterationId,
  txHash,
  startedAt,
}: {
  context: BotLoopContext;
  operations: BotLoopOperations;
  iterationId: number;
  txHash: ccc.Hex;
  startedAt: number;
}): Promise<void> {
  for (;;) {
    try {
      const committed = await operations.waitTransaction(
        context.runtime.client,
        txHash,
        0,
        BOT_TRANSACTION_WAIT_TIMEOUT_MS,
        BOT_TRANSACTION_WAIT_INTERVAL_MS,
      );
      const confirmation = {
        txHash,
        phase: "confirmation",
        outcome: "committed",
        status: committed?.status ?? "committed",
        elapsedMs: Date.now() - startedAt,
        timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
        intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
      };
      context.events.emit(iterationId, "bot.transaction.confirmation", {
        ...confirmation,
        retryable: false,
        terminal: true,
      });
      context.events.emit(iterationId, "bot.transaction.committed", confirmation);
      return;
    } catch (error) {
      const confirmationError = postBroadcastError(txHash, error);
      const retryable = isRetryableBotError(confirmationError);
      const failure = {
        txHash,
        phase: "confirmation",
        outcome: confirmationError.isTimeout ? "timeout" : "confirmation_failed",
        status: confirmationError.status,
        ...(confirmationError.reason === undefined
          ? {}
          : { reason: confirmationError.reason }),
        isTimeout: confirmationError.isTimeout,
        retryable,
        terminal: !confirmationError.isTimeout && !retryable,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
        intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
        error: errorSummary(confirmationError, {
          includeStack: !retryable && !confirmationError.isTimeout,
        }),
      };
      context.events.emit(iterationId, "bot.transaction.confirmation", failure);
      if (confirmationError.isTimeout) {
        continue;
      }
      context.events.emit(iterationId, "bot.transaction.failed", failure);
      throw confirmationError;
    }
  }
}

class BotTransactionConfirmationError extends Error {
  public override readonly name = "BotTransactionConfirmationError";
  public readonly txHash: ccc.Hex;
  public readonly status: string;
  public readonly isTimeout: boolean;
  public readonly reason: string | undefined;
  public readonly rebuildReady: boolean;

  constructor(
    txHash: ccc.Hex,
    options: {
      cause: unknown;
      isTimeout: boolean;
      reason: string | undefined;
      rebuildReady: boolean;
      status: string;
    },
  ) {
    super(
      options.isTimeout
        ? `Transaction ${txHash} confirmation timed out`
        : `Transaction ${txHash} confirmation failed`,
      options,
    );
    this.txHash = txHash;
    this.status = options.status;
    this.isTimeout = options.isTimeout;
    this.reason = options.reason;
    this.rebuildReady = options.rebuildReady;
  }
}

function postBroadcastError(
  txHash: ccc.Hex,
  error: unknown,
): BotTransactionConfirmationError {
  const timeout =
    error instanceof ccc.ErrorClientWaitTransactionTimeout ||
    (error instanceof Error && error.name === "ErrorClientWaitTransactionTimeout");
  const status = errorField(error, "status") ?? (timeout ? "pending" : "unresolved");
  const reason = errorField(error, "reason");
  return new BotTransactionConfirmationError(txHash, {
    cause: error,
    isTimeout: timeout,
    reason,
    rebuildReady: error instanceof TransactionWaitError ? error.rebuildReady : false,
    status,
  });
}

function errorField(error: unknown, field: "reason" | "status"): string | undefined {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return undefined;
  }
  let value: unknown;
  if (field === "reason" && "reason" in error) {
    value = error.reason;
  } else if ("status" in error) {
    value = error.status;
  }
  return typeof value === "string" ? value : undefined;
}
