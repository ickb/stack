import type { ccc } from "@ckb-ccc/core";
import type { BroadcastDeadline, LockUpPolicy } from "../dao.ts";
import type { IckbDepositCell, ReceiptCell } from "../logic.ts";
import type { OrderGroup } from "../order/cells.ts";
import type { Ratio } from "../order/ratio.ts";
import type { WithdrawalGroup } from "../owned_owner.ts";

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
  /** The latest date at which everything the wallet already has converting is collectable. */
  estimatedMaturity: bigint;
}

/**
 * Inputs and policy limits for building one conversion transaction.
 */
export interface ConversionTransactionOptions {
  /** Conversion direction to build. */
  direction: ConversionDirection;

  /**
   * Requested input amount in the source asset; zero builds the collection alone, which
   * does not use `direction` beyond checking it is one of the two.
   */
  amount: bigint;

  /**
   * Signer whose committed cells fund the completed transaction; its recommended lock owns
   * every cell the transaction creates for the user.
   */
  signer: ccc.Signer;

  /** Sampled state used to plan this conversion. */
  context: ConversionTransactionContext;
}

/**
 * Reason a conversion transaction could not be built without throwing.
 */
export type ConversionTransactionFailureReason =
  "insufficient-ckb" | "insufficient-ickb" | "insufficient-capacity" | "amount-too-small";

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
      /** The fee completion planned: the `plannedFee` to pass to `signAndSendTransaction`. */
      plannedFee: bigint;
      /**
       * When this conversion alone is collectable, from the tip: its direct claims and its
       * order's estimate; the tip for a collection. Positions already converting are dated
       * by the context's `estimatedMaturity`.
       */
      estimatedMaturity: bigint;
      /** Composition of the selected conversion path. */
      conversionKind: ConversionKind;
      /**
       * CKB the minted order and its master cell occupy, beyond the amount converting: the
       * wallet holds it in the order until it is collected. Absent when no order is minted.
       */
      orderOccupiedCapacity?: bigint;
      /**
       * The epoch the transaction must be broadcast before for its withdrawal requests to
       * claim at their sampled dates (`system.lockUp`); absent when it requests none.
       */
      broadcastBefore?: BroadcastDeadline;
    }
  | {
      ok: false;
      reason: "amount-too-small";
      /**
       * The smallest amount this direction accepts at the current fee rate, in the
       * request's unit (CKB shannons or iCKB), so a caller can name it.
       */
      minimum: bigint;
    }
  | {
      ok: false;
      /**
       * Completion could not fund the cells and the fee from the given liquid cells, for the
       * last and smallest plan too.
       */
      reason: "insufficient-capacity";
      /** CCC's capacity error from the fee completion. */
      cause: unknown;
    }
  | {
      ok: false;
      /**
       * The amount exceeds the balance, or, for `insufficient-ickb`, completion found the
       * given iCKB cells short of what the outputs need.
       */
      reason: "insufficient-ckb" | "insufficient-ickb";
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
  /**
   * The most CKB a CKB-to-iCKB conversion can always take: `ckbAvailable` less the cells
   * and fee of an order-only conversion, the shape with the fewest cells to fund. A Max
   * button's amount; never negative.
   */
  ckbConvertible: bigint;
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
  /**
   * Order groups the next transaction collects, budgeted as account value: at most the 128
   * one transaction melts.
   */
  availableOrders: OrderGroup[];
  /** Order groups still on the book, or ready but past the cap and collected in a later turn. */
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
  /** The CKB of one deposit worth `ICKB_DEPOSIT_CAP` iCKB at `exchangeRatio`. */
  depositCapacity: bigint;
  /** Every order past par on the book, the wallet's own included: what the bot can fill. */
  orderBook: OrderGroup[];
  /** Every iCKB pool deposit with its claim epoch at this tip: the CKB supply. */
  poolDeposits: IckbDepositCell[];
  /** The caller's withdrawal timing rules, which every builder and the sender follow. */
  lockUp: LockUpPolicy;
}
