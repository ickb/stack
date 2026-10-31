import type { ccc } from "@ckb-ccc/core";
import { projectAccountAvailability } from "../../../src/conversion/projection.ts";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { readyDeposits } from "../../../src/logic.ts";
import { TransactionBroadcastError } from "../../../src/send/sign_and_send_transaction.ts";
import { waitTransaction } from "../../../src/send/wait_transaction.ts";
import { ckbFromUdt } from "../../../src/udt.ts";
import type { BotEventEmitter } from "./events.ts";
import { spendableCkb } from "./policy.ts";
import { buildTransaction } from "./transaction.ts";
import type {
  BotState,
  BotStateSummary,
  BuildTransactionResult,
  Runtime,
} from "./types.ts";

type BuiltTransactionResult = Extract<BuildTransactionResult, { kind: "built" }>;

export interface BotTurnContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, managers, and primary lock. */
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
export async function readBotState(runtime: Runtime): Promise<BotState> {
  const { system, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
    BOT_LOCK_UP,
    runtime.maxFeeRate,
  );
  const projection = projectAccountAvailability(account, { available: [], pending: [] });

  return {
    system,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    notReadyWithdrawals: projection.pendingWithdrawals,
    cells: [...account.capacityCells, ...account.nativeUdtCells],
    ckb: projection.ckbAvailable,
    ickb: projection.ickbAvailable,
    pendingCkb: projection.ckbPending,
  };
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
  let txHash: ccc.Hex;
  try {
    txHash = await context.runtime.sendTransaction(
      result.tx,
      result.plannedFee,
      result.broadcastBefore,
    );
    context.events.emit({
      type: "bot.transaction.sent",
      txHash,
      outcome: "broadcasted",
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (!(error instanceof TransactionBroadcastError)) {
      throw error;
    }
    // The hash is known, so the node may have the transaction: wait for it.
    txHash = error.txHash;
    context.events.emit({
      type: "bot.transaction.sent",
      txHash,
      outcome: "broadcast_ambiguous",
      elapsedMs: Date.now() - startedAt,
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
  await waitTransaction(context.runtime.client, txHash, {
    timeout: BOT_TRANSACTION_WAIT_TIMEOUT_MS,
    interval: BOT_TRANSACTION_WAIT_INTERVAL_MS,
  });
  context.events.emit({
    type: "bot.transaction.committed",
    txHash,
    elapsedMs: Date.now() - startedAt,
  });
}

/** Builds the state summary a turn journals as `bot.state.read`. */
function summarizeBotState(state: BotState): BotStateSummary {
  const { tip, exchangeRatio, feeRate } = state.system;
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
      ckb: state.ckb,
      ickb: state.ickb,
      pendingCkb: state.pendingCkb,
      totalEquivalentCkb:
        state.ckb + state.pendingCkb + ckbFromUdt(state.ickb, exchangeRatio),
      matchableCkb: spendableCkb(state.ckb),
      cellCount: state.cells.length,
    },
    counts: {
      marketOrders: state.system.orderPool.length,
      receipts: state.receipts.length,
      readyWithdrawals: state.readyWithdrawals.length,
      pendingWithdrawals: state.notReadyWithdrawals.length,
      poolDeposits: state.system.poolDeposits.length,
      readyPoolDeposits: readyDeposits(
        state.system.poolDeposits,
        tip,
        state.system.lockUp,
      ).length,
    },
    exchangeRatio: { ckbScale: exchangeRatio.ckbScale, udtScale: exchangeRatio.udtScale },
    depositCapacity: state.system.depositCapacity,
    feeRate,
  };
}
