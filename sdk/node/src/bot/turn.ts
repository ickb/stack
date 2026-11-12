import { projectState, sumCkb } from "../../../src/conversion/projection.ts";
import type { State } from "../../../src/conversion/types.ts";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { readyDeposits } from "../../../src/logic.ts";
import { readRawState } from "../../../src/state.ts";
import { ckbFromUdt } from "../../../src/udt.ts";
import { COMMIT_BUDGET_MS } from "../shared/chain.ts";
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
 * Runs one bot turn: read state, decide, and at most one commit, followed for two minutes
 * past `sent`. Any failure propagates to the entry point, which journals it and exits 1.
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
  await commitBuiltTransaction({ context, result });
}

async function commitBuiltTransaction({
  context,
  result,
}: {
  context: BotTurnContext;
  result: BuiltTransactionResult;
}): Promise<void> {
  const startedAt = Date.now();
  // Replaced at `sent`, which comes before any pending step.
  let sentAt = startedAt;
  for await (const step of context.runtime.commitTransaction(result)) {
    const { txHash, cause } = step;
    const elapsedMs = Date.now() - startedAt;
    const outcome = step.ok ? step.status : step.reason;
    if (outcome === "sent") {
      context.events.emit({
        type: "bot.transaction.sent",
        txHash,
        elapsedMs,
        ...(cause === undefined
          ? { outcome: "broadcasted" }
          : { outcome: "broadcast_ambiguous", error: cause }),
      });
      sentAt = Date.now();
      continue;
    }
    // Nothing sent, a rejection or a failed read: the bot recovers by exiting, and the next
    // process rebuilds from committed state.
    if (!step.ok || cause !== undefined) {
      throw new Error(`Transaction ${txHash} ${outcome}`, { cause: step });
    }
    if (outcome === "committed") {
      context.events.emit({ type: "bot.transaction.committed", txHash, elapsedMs });
      return;
    }
    // A send still pending is no failure: the next turn rebuilds over it on schedule, which
    // replaces it at the node when the rebuild pays enough more.
    if (Date.now() - sentAt >= COMMIT_BUDGET_MS) {
      context.events.emit({ type: "bot.transaction.unresolved", txHash });
      return;
    }
  }
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
      matchableCkb: spendableCkb(state.ckbConvertible),
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
