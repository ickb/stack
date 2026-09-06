import type { ccc } from "@ckb-ccc/core";
import { TransactionBroadcastError, waitTransaction } from "@ickb/sdk";
import { STOP_EXIT_CODE } from "../shared/index.ts";
import type { BotEventEmitter } from "./events.ts";
import { handleTurnFailure } from "./failure.ts";
import { emptyActions, summarizeBotState, transactionShape } from "./runtime/support.ts";
import { buildTransaction } from "./runtime/transaction.ts";
import type { BotState, BuildTransactionResult, Runtime } from "./runtime/types.ts";
import { readBotState } from "./state.ts";

type BuiltTransactionResult = Extract<BuildTransactionResult, { kind: "built" }>;

export interface BotTurnContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, managers, and primary lock. */
  runtime: Runtime;
}

export const BOT_TRANSACTION_WAIT_TIMEOUT_MS = 600_000;
export const BOT_TRANSACTION_WAIT_INTERVAL_MS = 10_000;

/** Runs one bot turn: read state, decide, and at most one broadcast with its confirmation wait. */
export async function runBotTurn(context: BotTurnContext): Promise<void> {
  try {
    await executeBotWork(context);
  } catch (error) {
    handleTurnFailure(context.events, error);
  }
}

async function executeBotWork(context: BotTurnContext): Promise<void> {
  const state = await readBotState(context.runtime);
  const summary = summarizeBotState(state);
  context.events.emit({ type: "bot.state.read", ...summary });

  if (summary.balances.totalEquivalentCkb <= state.minCkbBalance) {
    context.events.emit({
      type: "bot.decision.skipped",
      reason: "capital_below_minimum",
      actions: emptyActions(),
      state: summary,
      deficit: summary.balances.minimumCkbCapital - summary.balances.totalEquivalentCkb,
    });
    process.exitCode = STOP_EXIT_CODE;
    return;
  }

  const result = await buildTransaction(context.runtime, state);
  if (result.kind === "skipped") {
    context.events.emit({
      type: "bot.decision.skipped",
      reason: result.reason,
      actions: result.actions,
      decision: result.decision,
    });
    return;
  }
  context.events.emit({
    type: "bot.transaction.built",
    actions: result.actions,
    fee: result.decision.fee,
    transactionShape: result.decision.transactionShape,
    decision: result.decision,
  });
  await sendBuiltTransaction({ context, state, result });
}

async function sendBuiltTransaction({
  context,
  state,
  result,
}: {
  context: BotTurnContext;
  state: BotState;
  result: BuiltTransactionResult;
}): Promise<void> {
  const startedAt = Date.now();
  const sent = {
    fee: result.tx.estimateFee(state.system.feeRate),
    feeRate: state.system.feeRate,
    transactionShape: transactionShape(result.tx),
  };
  let recordedHash: ccc.Hex | undefined;
  let txHash: ccc.Hex;
  try {
    txHash = await context.runtime.sendTransaction(result.tx, (hash) => {
      recordedHash = hash;
    });
    context.events.emit({
      type: "bot.transaction.sent",
      txHash,
      outcome: "broadcasted",
      elapsedMs: Date.now() - startedAt,
      ...sent,
    });
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError)) {
      throw error;
    }
    // The hash is known, so the node may have the transaction: wait for it.
    txHash = recordedHash ?? error.txHash;
    context.events.emit({
      type: "bot.transaction.sent",
      txHash,
      outcome: "broadcast_ambiguous",
      elapsedMs: Date.now() - startedAt,
      ...sent,
      error,
    });
  }
  await confirmTransaction({ context, txHash, startedAt });
}

async function confirmTransaction({
  context,
  txHash,
  startedAt,
}: {
  context: BotTurnContext;
  txHash: ccc.Hex;
  startedAt: number;
}): Promise<void> {
  // A terminal status or the timeout throws an SDK error that names the hash and status;
  // it ends the turn through `bot.turn.failed`.
  const committed = await waitTransaction(context.runtime.client, txHash, {
    timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
  context.events.emit({
    type: "bot.transaction.committed",
    txHash,
    status: committed.status,
    elapsedMs: Date.now() - startedAt,
    timeoutMs: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    intervalMs: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
}
