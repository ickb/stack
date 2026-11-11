import type { ccc } from "@ckb-ccc/core";
import { projectState, sumCkb } from "../../../src/conversion/projection.ts";
import type { State } from "../../../src/conversion/types.ts";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { readyDeposits } from "../../../src/logic.ts";
import { waitTransaction } from "../../../src/send/wait_transaction.ts";
import { readRawState } from "../../../src/state.ts";
import { ckbFromUdt } from "../../../src/udt.ts";
import type { BotEventEmitter } from "./events.ts";
import { spendableCkb } from "./policy.ts";
import { buildTransaction } from "./transaction.ts";
import type { BotStateSummary, BuildTransactionResult, Runtime } from "./types.ts";

type BuiltTransactionResult = Extract<BuildTransactionResult, { kind: "built" }>;

export interface BotTurnContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, and account locks. */
  runtime: Runtime;
}

// The wait only lets this turn journal its own commit: the next turn rebuilds from committed
// state. Two minutes covers every commit journalled so far (77 s at most, 54 s at p90). A
// longer wait would only delay the exit after a stuck send; the ten-minute restart, not this
// wait, now dominates how long a failed withdrawal request waits to be rebuilt.
export const BOT_TRANSACTION_WAIT_TIMEOUT_MS = 120_000;
const BOT_TRANSACTION_WAIT_INTERVAL_MS = 10_000;

/**
 * Reads bot-owned account state and public market state for one planning attempt.
 *
 * @remarks The bot places no orders, so nothing here counts or collects any; the market
 * side of the state is every order past par. The fee rate is the sampled one, capped by
 * the state read at the runtime's `maxFeeRate` when set: the sampled rate is a node
 * statistic nothing can verify, so the cap bounds what a node can make the bot pay and
 * what it can make the match gate refuse.
 */
export async function readBotState(runtime: Runtime): Promise<State> {
  const { system, account } = await readRawState(
    runtime.client,
    runtime.accountLocks,
    BOT_LOCK_UP,
    runtime.maxFeeRate,
  );
  return projectState(system, account, [], runtime.accountLocks[0]);
}

/**
 * Runs one bot turn: read state, decide, and at most one broadcast with its confirmation
 * wait. Any failure propagates to the entry point, which journals it and exits 1.
 */
export async function runBotTurn(context: BotTurnContext): Promise<void> {
  const state = await readBotState(context.runtime);
  const summary = summarizeBotState(state);
  context.events.emit({ type: "bot.state.read", ...summary });

  const result = await buildTransaction(context.runtime, state);
  if (result.kind === "skipped") {
    context.events.emit({
      type: "bot.decision.skipped",
      reason: result.reason,
      decision: result.decision,
    });
    return;
  }
  context.events.emit({ type: "bot.transaction.built", decision: result.decision });
  await sendBuiltTransaction({ context, result });
}

async function sendBuiltTransaction({
  context,
  result,
}: {
  context: BotTurnContext;
  result: BuiltTransactionResult;
}): Promise<void> {
  const startedAt = Date.now();
  const sent = await context.runtime.sendTransaction(result);
  // Nothing was sent: the bot recovers by exiting, and the next process rebuilds.
  if (!sent.ok && sent.reason !== "maybe-sent") {
    throw new Error(`Transaction not sent: ${sent.reason}`, { cause: sent });
  }
  // A maybe-sent hash may be on the node, so it is waited on like a sent one.
  const { txHash } = sent;
  context.events.emit({
    type: "bot.transaction.sent",
    txHash,
    elapsedMs: Date.now() - startedAt,
    ...(sent.ok
      ? { outcome: "broadcasted" }
      : { outcome: "broadcast_ambiguous", error: sent.cause }),
  });
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
  const done = await waitTransaction(context.runtime.client, txHash, {
    timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
  // A rejection or the timeout ends the turn through `bot.turn.failed`; the next process
  // rebuilds from committed state.
  if (!done.ok) {
    throw new Error(`Transaction ${txHash} ${done.reason}`, { cause: done });
  }
  context.events.emit({
    type: "bot.transaction.committed",
    txHash,
    elapsedMs: Date.now() - startedAt,
  });
}

/** Builds the state summary a turn journals as `bot.state.read`. */
function summarizeBotState(state: State): BotStateSummary {
  const { tip, exchangeRatio, feeRate } = state;
  const pendingCkb = sumCkb(state.pendingWithdrawals);
  return {
    chainTip: {
      blockNumber: tip.number,
      blockHash: tip.hash,
      timestamp: tip.timestamp,
      epoch: {
        integer: tip.epoch.integer,
        numerator: tip.epoch.numerator,
        denominator: tip.epoch.denominator,
      },
    },
    balances: {
      ckb: state.ckbAvailable,
      ickb: state.ickbAvailable,
      pendingCkb,
      totalEquivalentCkb:
        state.ckbAvailable + pendingCkb + ckbFromUdt(state.ickbAvailable, exchangeRatio),
      matchableCkb: spendableCkb(state.ckbAvailable),
      cellCount: state.cells.length,
    },
    counts: {
      marketOrders: state.orderBook.length,
      receipts: state.receipts.length,
      readyWithdrawals: state.readyWithdrawals.length,
      pendingWithdrawals: state.pendingWithdrawals.length,
      poolDeposits: state.poolDeposits.length,
      readyPoolDeposits: readyDeposits(state.poolDeposits, tip, state.lockUp).length,
    },
    exchangeRatio: { ckbScale: exchangeRatio.ckbScale, udtScale: exchangeRatio.udtScale },
    depositCapacity: state.depositCapacity,
    feeRate,
  };
}
