import { ccc } from "@ckb-ccc/core";
import { STOP_EXIT_CODE } from "@ickb/node-utils";
import { TransactionBroadcastError, waitTransaction } from "@ickb/sdk";
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

export interface BotTurnOperations {
  buildTransaction: typeof buildTransaction;
  readBotState: typeof readBotState;
  waitTransaction: typeof waitTransaction;
}

export interface BotTurnContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, managers, and primary lock. */
  runtime: Runtime;

  /** Optional effect overrides. Production callers use the defaults. */
  operations?: Partial<BotTurnOperations>;
}

const defaultBotTurnOperations: BotTurnOperations = {
  buildTransaction,
  readBotState,
  waitTransaction,
};

// One process is one turn; the event contract still numbers it as iteration 1.
const TURN_ITERATION_ID = 1;

export const BOT_TRANSACTION_WAIT_TIMEOUT_MS = 600_000;
export const BOT_TRANSACTION_WAIT_INTERVAL_MS = 10_000;

/** Runs one bot turn: read state, decide, and at most one broadcast with its confirmation wait. */
export async function runBotTurn(context: BotTurnContext): Promise<void> {
  const operations = { ...defaultBotTurnOperations, ...context.operations };
  context.events.emit(TURN_ITERATION_ID, "bot.iteration.started");
  try {
    await executeBotWork(context, operations, TURN_ITERATION_ID);
  } catch (error) {
    handleIterationFailure(context.events, TURN_ITERATION_ID, error);
  }
}

async function executeBotWork(
  context: BotTurnContext,
  operations: BotTurnOperations,
  iterationId: number,
): Promise<void> {
  const state = await operations.readBotState(context.runtime);
  const stateDecision = summarizeBotState(state);
  emitBotStateRead(context.events, iterationId, stateDecision);

  if (stateDecision.balances.totalEquivalentCkb <= state.minCkbBalance) {
    stopForLowCapital({
      events: context.events,
      iterationId,
      stateDecision,
    });
    return;
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
  context: BotTurnContext;
  operations: BotTurnOperations;
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
  context: BotTurnContext;
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
  context: BotTurnContext;
  operations: BotTurnOperations;
  iterationId: number;
  txHash: ccc.Hex;
  startedAt: number;
}): Promise<void> {
  try {
    const committed = await operations.waitTransaction(context.runtime.client, txHash, {
      timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
      interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
    });
    const confirmation = {
      txHash,
      phase: "confirmation",
      outcome: "committed",
      status: committed.status,
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
      terminal: !retryable,
      elapsedMs: Date.now() - startedAt,
      timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
      intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
      error: errorSummary(confirmationError, { includeStack: !retryable }),
    };
    context.events.emit(iterationId, "bot.transaction.confirmation", failure);
    context.events.emit(iterationId, "bot.transaction.failed", failure);
    throw confirmationError;
  }
}

class BotTransactionConfirmationError extends Error {
  public override readonly name = "BotTransactionConfirmationError";
  public readonly txHash: ccc.Hex;
  public readonly status: string;
  public readonly isTimeout: boolean;
  public readonly reason: string | undefined;

  constructor(
    txHash: ccc.Hex,
    options: {
      cause: unknown;
      isTimeout: boolean;
      reason: string | undefined;
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
