import type { ccc } from "@ckb-ccc/core";
import type { CompleteTransactionResult } from "../../../src/complete.ts";
import type { State } from "../../../src/conversion/types.ts";
import type { BroadcastDeadline } from "../../../src/dao.ts";
import type { IckbDepositCell } from "../../../src/logic.ts";
import type { IckbSdk } from "../../../src/sdk.ts";
import type { signAndSendTransaction } from "../../../src/send/sign_and_send_transaction.ts";
import type { transactionShape } from "../shared/format.ts";

import type { DepositReason, RingSummary } from "./policy.ts";

/** Runtime dependencies used by each bot loop iteration. */
export interface Runtime {
  /** CCC client for the configured chain. */
  client: ccc.Client;

  /** SDK instance for public state reads and partial transaction builders. */
  sdk: IckbSdk;

  /**
   * Account locks derived once during signer initialization, the primary first: the state's
   * change lock, which receives change and every other key's cells.
   */
  accountLocks: [ccc.Script, ...ccc.Script[]];

  /** The most the bot plans to pay per kB, in shannons, whatever rate the node reports. */
  maxFeeRate?: ccc.Num;

  /** Completes a transaction from the turn's state through the initialization-owned signer closure. */
  completeTransaction: (
    tx: ccc.TransactionLike,
    state: State,
  ) => Promise<CompleteTransactionResult>;

  /** Signs and sends a build result through the initialization-owned signer. */
  sendTransaction: (
    built: Parameters<typeof signAndSendTransaction>[1],
  ) => Promise<ccc.Hex>;
}

/** Counts of actions a transaction carries. */
export interface BotActions {
  matchedOrders: number;
  deposits: number;
  withdrawalRequests: number;
  completedDeposits: number;
  withdrawals: number;
}

export type BuildTransactionSkipReason = "no_actions" | "no_fundable_candidate";

/**
 * Why the turn carries no match: an empty book, no fill on it that returns its cost at any
 * size, or fills that would but the balances cannot pay, which is the inventory an operator
 * may want to top up.
 */
export type BotMatchReason = "matched" | "no_market_orders" | "no_gain" | "unfunded_gain";

/** One action core the completion walk tries; the match and the collections ride on every one. */
export type Core =
  | { kind: "none" }
  | { kind: "deposit"; reason: DepositReason }
  | { kind: "withdraw"; deposits: IckbDepositCell[]; stress: boolean };

/** Bot transaction-build outcome with the decision evidence used for logs and events. */
export type BuildTransactionResult =
  | {
      kind: "built";
      tx: ccc.Transaction;
      /** The fee completion planned, which the send refuses to exceed. */
      plannedFee: bigint;
      decision: BotDecision;
      /** The epoch the withdrawal requests aboard must be broadcast before; absent without any. */
      broadcastBefore?: BroadcastDeadline;
    }
  | { kind: "skipped"; reason: BuildTransactionSkipReason; decision: BotDecision };

/** What a turn read, as `bot.state.read` journals it. */
export interface BotStateSummary {
  chainTip: {
    blockNumber: bigint;
    blockHash: ccc.Hex;
    timestamp: bigint;
    epoch: { integer: bigint; numerator: bigint; denominator: bigint };
  };
  balances: {
    ckb: bigint;
    ickb: bigint;
    pendingCkb: bigint;
    /** Total liquid capital in CKB terms, own orders excluded. */
    totalEquivalentCkb: bigint;
    matchableCkb: bigint;
    cellCount: number;
  };
  counts: {
    marketOrders: number;
    receipts: number;
    readyWithdrawals: number;
    pendingWithdrawals: number;
    poolDeposits: number;
    readyPoolDeposits: number;
  };
  exchangeRatio: { ckbScale: bigint; udtScale: bigint };
  depositCapacity: bigint;
  /** The rate the turn plans at: the sampled one, or `BOT_MAX_FEE_RATE` when that binds. */
  feeRate: ccc.Num;
}

/** What a turn decided, beside the state its `bot.state.read` line journaled. */
export interface BotDecision {
  match: {
    reason: BotMatchReason;
    partialCount: number;
    ckbDelta: bigint;
    udtDelta: bigint;
    matchedOrderOutPoints?: Array<{ txHash: ccc.Hex; index: string }>;
    /** Matchable order directions on the book, each probed at every step. */
    candidates: number;
    /** Directions whose fill returns its cost at full size, whether or not the balances pay it. */
    gains: number;
    /** The mining fee of one fill; a fill is taken only above ten of them. */
    fee: bigint;
    /** The shuffle seed of the turn's match. */
    seed: number;
  };
  rebalance: {
    deposit?: DepositReason;
    withdrawal?: { candidateCount: number; stress: boolean };
    ring: RingSummary;
  };
  /** The core the walk settled on and how many candidates it built on the way. */
  core: { kind: Core["kind"]; attempts: number };
  actions: BotActions;
  /** The fee completion planned, which the send refuses to exceed; absent without a transaction. */
  plannedFee?: bigint;
  transactionShape?: ReturnType<typeof transactionShape>;
}
