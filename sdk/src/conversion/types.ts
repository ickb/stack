import type { ccc } from "@ckb-ccc/core";
import type { BroadcastDeadline, LockUpPolicy } from "../dao.ts";
import type { IckbDepositCell, LogicManager, ReceiptCell } from "../logic.ts";
import type { OrderGroup } from "../order/cells.ts";
import type { OrderManager } from "../order/order.ts";
import type { Ratio } from "../order/ratio.ts";
import type { OwnedOwnerManager, WithdrawalGroup } from "../owned_owner.ts";
import type { IckbUdt } from "../udt.ts";

/**
 * Direction requested by a conversion transaction.
 */
export type ConversionDirection = "ckb-to-ickb" | "ickb-to-ckb";

/**
 * Snapshot used to plan one wallet conversion transaction.
 */
export interface ConversionTransactionContext {
  /** Public system state sampled for conversion planning. */
  system: SystemState;
  /** User receipt cells available for deposit completion. */
  receipts: ReceiptCell[];
  /** User withdrawal groups ready to complete. */
  readyWithdrawals: WithdrawalGroup[];
  /** Order groups available for collection or budgeting as account value. */
  availableOrders: OrderGroup[];
  /** The wallet's liquid cells, plain CKB and iCKB, that completion funds from and sweeps. */
  cells: ccc.Cell[];
  /** Projected CKB available to the wallet after pending state is considered. */
  ckbAvailable: bigint;
  /** Projected iCKB available to the wallet after pending state is considered. */
  ickbAvailable: bigint;
  /**
   * The latest date at which everything the wallet has converting, plus this request, is
   * collectable; an amount of zero is the collection itself.
   */
  estimatedMaturity: bigint;
}

/**
 * Inputs and policy limits for building one conversion transaction.
 */
export interface ConversionTransactionOptions {
  /** Conversion direction to build. */
  direction: ConversionDirection;

  /** Requested input amount in the source asset. */
  amount: bigint;

  /**
   * Lock that owns every cell the transaction creates for the user, the conversion outputs
   * and the change; the signer's recommended lock by default. Completion sweeps the liquid
   * cells along within its input limit, so a foreign lock redirects those funds too.
   */
  lock?: ccc.Script;

  /** Signer whose committed cells fund the completed transaction. */
  signer: ccc.Signer;

  /** Sampled state used to plan this conversion. */
  context: ConversionTransactionContext;
}

/**
 * Reason a conversion transaction could not be built without throwing.
 */
export type ConversionTransactionFailureReason =
  | "amount-negative"
  | "insufficient-ckb"
  | "insufficient-ickb"
  | "amount-too-small"
  | "nothing-to-do";

/**
 * A dust iCKB-to-CKB order: too small for the default fee to clear the estimate threshold,
 * so it pays the smallest fee that does. For callers to surface in UI or logs.
 */
export interface ConversionNotice {
  /** iCKB input amount that triggered the notice. */
  inputIckb: bigint;

  /** CKB output estimate for the noticed path. */
  outputCkb: bigint;

  /** CKB incentive associated with the noticed path. */
  incentiveCkb: bigint;
}

/** Composition category selected for a built conversion. */
export type ConversionKind = "direct" | "order" | "direct-plus-order" | "collect-only";

/**
 * Result of attempting to build a conversion transaction.
 */
export type ConversionTransactionResult =
  | {
      ok: true;
      /** Completed transaction, funded from the signer's committed cells. Callers own signing and send. */
      tx: ccc.Transaction;
      /** Estimated maturity timestamp for the conversion result. */
      estimatedMaturity: bigint;
      /** Composition of the selected conversion path. */
      conversionKind: ConversionKind;
      /** Optional notice about the selected path. */
      conversionNotice?: ConversionNotice;
      /**
       * True when every liquid cell of the context is an input. False when the input limit
       * left some behind: a move to another lock then needs another transaction.
       */
      isSweepComplete: boolean;
      /**
       * The epoch the transaction must be broadcast before for its withdrawal requests to
       * claim at their sampled dates (`system.lockUp`); absent when it requests none.
       */
      broadcastBefore?: BroadcastDeadline;
    }
  | {
      ok: false;
      reason: "amount-too-small";
      /** Best available maturity estimate from the input context. */
      estimatedMaturity: bigint;
      /**
       * The smallest amount this direction accepts at the current fee rate, in the
       * request's unit (CKB shannons or iCKB), so a caller can name it.
       */
      minimum: bigint;
    }
  | {
      ok: false;
      /** Machine-readable failure reason. */
      reason: Exclude<ConversionTransactionFailureReason, "amount-too-small">;
      /** Best available maturity estimate from the input context. */
      estimatedMaturity: bigint;
    };

/**
 * Raw wallet-owned cells and grouped iCKB state sampled from L1.
 */
export interface AccountState {
  /** Plain capacity cells owned by the account locks. */
  capacityCells: ccc.Cell[];
  /** Native iCKB xUDT cells owned by the account locks. */
  nativeUdtCells: ccc.Cell[];
  /** Receipt cells owned by the account. */
  receipts: ReceiptCell[];
  /** Withdrawal groups owned by the account. */
  withdrawalGroups: WithdrawalGroup[];
}

/**
 * Account balances split into available, pending, and order/withdrawal buckets.
 */
export interface AccountAvailabilityProjection {
  /**
   * CKB in the account's liquid cells, plain and iCKB alike: what the wallet shows and what
   * the next transaction spends, before the change cells, an order's master cell and the
   * fee it must fund on top.
   */
  ckbNative: bigint;
  /** iCKB in the account's native iCKB cells. */
  ickbNative: bigint;
  /** `ckbNative` plus the CKB the receipts, ready withdrawals and collectable orders return. */
  ckbAvailable: bigint;
  /** `ickbNative` plus the iCKB the receipts and collectable orders return. */
  ickbAvailable: bigint;
  /** CKB pending in withdrawals or orders. */
  ckbPending: bigint;
  /** iCKB pending in withdrawals or orders. */
  ickbPending: bigint;
  /** Total CKB balance including pending positions. */
  ckbBalance: bigint;
  /** Total iCKB balance including pending positions. */
  ickbBalance: bigint;
  /**
   * Matured withdrawal groups one transaction can complete: at most the deposit-header slots
   * the DAO script addresses (`DAO_HEADER_INDEX_LIMIT`), which the deposit headers hold alone.
   */
  readyWithdrawals: WithdrawalGroup[];
  /** Withdrawal groups still waiting for DAO maturity or for a header slot in a later turn. */
  pendingWithdrawals: WithdrawalGroup[];
  /** Order groups available for collection or budgeting as account value. */
  availableOrders: OrderGroup[];
  /** Order groups that are owned but unavailable or unresolved. */
  pendingOrders: OrderGroup[];
}

/**
 * Combined projection and transaction-planning context for one sampled account state.
 */
export interface ConversionTransactionContextProjection {
  /** User-facing availability projection. */
  projection: AccountAvailabilityProjection;
  /** Builder-facing transaction context derived from the same sampled state. */
  context: ConversionTransactionContext;
}

/**
 * Public sampled system state used for quotes, maturity, and conversion planning.
 */
export interface SystemState {
  /** The fee rate for transactions. */
  feeRate: ccc.Num;
  /** The sampled tip's parent, this L1 scan's anchor. It may be stale after scans complete. */
  tip: ccc.ClientBlockHeader;
  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: Ratio;
  /** Every order past par on the book, the wallet's own included: what the bot can fill. */
  orderPool: OrderGroup[];
  /** Every iCKB pool deposit with its claim epoch at this tip: the CKB supply. */
  poolDeposits: IckbDepositCell[];
  /** The caller's withdrawal timing rules, which every builder and the sender follow. */
  lockUp: LockUpPolicy;
}

/** Manager set that builds one iCKB SDK instance. */
export interface SdkManagers {
  /** iCKB xUDT manager with receipt and DAO deposit aware completion. */
  ickbUdt: IckbUdt;
  /** Owned-owner manager for withdrawal request and claim cells. */
  ownedOwner: OwnedOwnerManager;
  /** iCKB Logic manager for deposits and receipts. */
  ickbLogic: LogicManager;
  /** Limit order manager. */
  order: OrderManager;
}
