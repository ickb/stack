import type { ccc } from "@ckb-ccc/core";
import type { getConfig } from "../../../../src/constants.ts";
import type { SystemState } from "../../../../src/conversion/sdk_types.ts";
import type {
  IckbDepositCell,
  ReceiptCell,
  WithdrawalGroup,
} from "../../../../src/core/index.ts";
import type { OrderGroup } from "../../../../src/order/index.ts";
import type { IckbSdk } from "../../../../src/sdk.ts";

import type { DepositReason, RingSummary } from "../policy.ts";

/** Runtime dependencies used by each bot loop iteration. */
export interface Runtime {
  /** CCC client for the configured chain. */
  client: ccc.Client;

  /** SDK instance for public state reads and partial transaction builders. */
  sdk: IckbSdk;

  /** Lower-level managers from the selected deployment config. */
  managers: ReturnType<typeof getConfig>["managers"];

  /** Primary lock controlled by the signer. */
  primaryLock: ccc.Script;

  /** Account locks derived once during signer initialization. */
  accountLocks: ccc.Script[];

  /** Completes a transaction through the initialization-owned signer closure. */
  completeTransaction: (
    tx: ccc.TransactionLike,
    feeRate: ccc.Num,
    cells: ccc.Cell[],
  ) => Promise<ccc.Transaction>;

  /** Signs and sends through the initialization-owned signer and exposes pre-RPC identity. */
  sendTransaction: (
    tx: ccc.TransactionLike,
    recordTxHash?: (txHash: ccc.Hex) => void,
  ) => Promise<ccc.Hex>;
}

/** Snapshot of bot-owned and public state used for one planning attempt. */
export interface BotState {
  /** Sampled public L1 state. */
  system: SystemState;

  /** Public market orders eligible for matching; own orders are not part of it. */
  marketOrders: OrderGroup[];

  /** User receipt cells ready for deposit completion. */
  receipts: ReceiptCell[];

  /** User withdrawal groups ready for withdrawal completion. */
  readyWithdrawals: WithdrawalGroup[];

  /** User withdrawal groups that are not ready yet. */
  notReadyWithdrawals: WithdrawalGroup[];

  /** Full public pool deposit snapshot. */
  poolDeposits: IckbDepositCell[];

  /** The bot's liquid cells, plain CKB and iCKB, that completion funds from and sweeps. */
  cells: ccc.Cell[];

  /** CKB available now: plain cells, collectible receipt capacity, ready withdrawals. */
  ckb: bigint;

  /** iCKB available now: xUDT cells plus receipts. */
  ickb: bigint;

  /** CKB locked in withdrawal requests that are not ready yet. */
  pendingCkb: bigint;

  /** Capacity of one cap-sized deposit output at the sampled exchange ratio. */
  depositCapacity: bigint;
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
  | { kind: "built"; tx: ccc.Transaction; actions: BotActions; decision: BotDecision }
  | {
      kind: "skipped";
      reason: BuildTransactionSkipReason;
      actions: BotActions;
      decision: BotDecision;
    };

/** Structured evidence for one bot planning attempt. */
export interface BotDecision {
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
  core: { kind: Core["kind"]; withdrawalRequests: number; attempts: number };
  actions: BotActions;
  fee: { feeRate: ccc.Num; estimated?: bigint };
  transactionShape?: {
    inputs: number;
    outputs: number;
    cellDeps: number;
    headerDeps: number;
    witnesses: number;
  };
  exchangeRatio: { ckbScale: bigint; udtScale: bigint };
  depositCapacity: bigint;
  skip?: { reason: BuildTransactionSkipReason };
}

export type BotStateSummary = Pick<
  BotDecision,
  "chainTip" | "balances" | "counts" | "exchangeRatio" | "depositCapacity" | "fee"
>;
