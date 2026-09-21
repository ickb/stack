import type { ccc } from "@ckb-ccc/core";
import { projectAccountAvailability } from "../../../src/conversion/projection.ts";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { TransactionBroadcastError } from "../../../src/send/sign_and_send_transaction.ts";
import { waitTransaction } from "../../../src/send/wait_transaction.ts";
import { convert, ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { transactionShape } from "../shared/format.ts";
import type { BotEventEmitter } from "./events.ts";
import { summarizeBotState } from "./support.ts";
import { buildTransaction } from "./transaction.ts";
import type { BotState, BuildTransactionResult, Runtime } from "./types.ts";

type BuiltTransactionResult = Extract<BuildTransactionResult, { kind: "built" }>;

export interface BotTurnContext {
  /** Event emitter scoped to this bot run. */
  events: BotEventEmitter;

  /** Runtime clients, signer, SDK, managers, and primary lock. */
  runtime: Runtime;
}

// The wait only lets this turn journal its own commit: the next turn rebuilds from committed
// state. A withdrawal request selects claims at least twenty minutes out and is sent while
// fifteen remain (`BOT_LOCK_UP`), so a long wait on a stuck one would eat the time to rebuild
// it before the deposit locked for another cycle. Two minutes covers every commit journalled
// so far (77 s at most, 54 s at p90).
export const BOT_TRANSACTION_WAIT_TIMEOUT_MS = 120_000;
export const BOT_TRANSACTION_WAIT_INTERVAL_MS = 10_000;

/**
 * Reads bot-owned account state and public market state for one planning attempt.
 *
 * @remarks The bot places no orders, so nothing here counts or collects any; the market
 * side of the state is every order past par (decisions amendment 52(ak)).
 */
export async function readBotState(runtime: Runtime): Promise<BotState> {
  const { system, account } = await runtime.sdk.getL1AccountState(
    runtime.client,
    runtime.accountLocks,
    BOT_LOCK_UP,
  );
  const projection = projectAccountAvailability(account, { available: [], pending: [] });

  return {
    system,
    marketOrders: system.orderPool,
    receipts: account.receipts,
    readyWithdrawals: projection.readyWithdrawals,
    notReadyWithdrawals: projection.pendingWithdrawals,
    poolDeposits: system.poolDeposits,
    cells: [...account.capacityCells, ...account.nativeUdtCells],
    ckb: projection.ckbAvailable,
    ickb: projection.ickbAvailable,
    pendingCkb: projection.ckbPending,
    depositCapacity: convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio),
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
    txHash = await context.runtime.sendTransaction(
      result.tx,
      (hash) => {
        recordedHash = hash;
      },
      result.broadcastBefore,
    );
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
