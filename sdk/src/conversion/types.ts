import type { ccc } from "@ckb-ccc/core";
import type { BroadcastDeadline, LockUpPolicy } from "../dao.ts";
import type { DepositCell, ReceiptCell } from "../logic.ts";
import type { OrderGroup } from "../order/cells.ts";
import type { WithdrawalGroup } from "../owned_owner.ts";
import type { ExchangeRatio } from "../utils/utils.ts";

/**
 * Direction requested by a conversion transaction.
 */
export type ConversionDirection = "ckb-to-ickb" | "ickb-to-ckb";

/**
 * Composition category selected for a built conversion. Every conversion mints an order,
 * beside direct deposits or withdrawals or alone; a collection mints none.
 */
export type ConversionKind = "order" | "direct-plus-order" | "collect-only";

/**
 * Result of attempting to build a conversion transaction.
 */
export type ConversionTransactionResult =
  | {
      ok: true;
      /** Completed transaction, funded from the signer's committed cells. Callers own signing and send. */
      tx: ccc.Transaction;
      /** The fee completion planned: the `plannedFee` to pass to `commitTransaction`. */
      plannedFee: bigint;
      /**
       * When this conversion alone is collectable, from the tip: its direct claims and its
       * order's estimate; the tip for a collection. Positions already converting are dated
       * by the state's `estimatedMaturity`.
       */
      estimatedMaturity: bigint;
      /** Composition of the selected conversion path. */
      conversionKind: ConversionKind;
      /**
       * CKB the minted order and its master cell occupy, beyond the amount converting: the
       * wallet holds it in the order until it is collected. Zero for a collection, which
       * mints none.
       */
      orderOccupiedCapacity: bigint;
      /**
       * The epoch the transaction must be broadcast before for its withdrawal requests to
       * claim at their sampled dates (`state.lockUp`); undefined when it requests none.
       */
      broadcastBefore: BroadcastDeadline | undefined;
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
 * Everything one read knows about the chain and the account: the sampled system, the
 * account's positions split by what the next transaction collects, and its totals. Every
 * consumer, a wallet screen, a builder or an actor, reads this one object.
 */
export interface State {
  /** The sampled tip's parent, this read's anchor. It may be stale after the scans complete. */
  tip: ccc.ClientBlockHeader;
  /** The fee rate for transactions. */
  feeRate: ccc.Num;
  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: ExchangeRatio;
  /** The CKB of one deposit worth `ICKB_DEPOSIT_CAP` iCKB at `exchangeRatio`. */
  depositCapacity: bigint;
  /** Every order past par on the book, the wallet's own included: what the bot can fill. */
  orderBook: OrderGroup[];
  /** Every iCKB pool deposit with its claim epoch at this tip: the CKB supply. */
  poolDeposits: DepositCell[];
  /** The iCKB the pool deposits are worth, the soft-cap discount included. */
  poolIckb: bigint;
  /** The CKB the pool deposits hold: their capacity plus the DAO interest to the tip. */
  poolCkb: bigint;
  /**
   * The nominal yearly DAO rate, in percent (2.03 means 2.03%), from the live tip and its
   * parent: one block's growth of the accumulated rate times a year of blocks, not
   * compounded (sdk/docs/state_read.md).
   */
  apyPercent: number;
  /**
   * The wallet's withdrawal timing rules, which every builder and the sender follow:
   * `readState` takes no policy, so a state it reads always carries the wallet's. (The
   * bot's internal read projects its own, `BOT_LOCK_UP`.)
   */
  lockUp: LockUpPolicy;
  /**
   * The signer's recommended lock, read once with the state: it owns every output a
   * conversion creates for the wallet, its change included.
   */
  changeLock: ccc.Script;
  /**
   * The liquid cells the next transaction spends, every one: the account's largest plain
   * cells, then its iCKB cells with the most iCKB, up to that transaction's share of each
   * (`MAX_OFFERED_PLAIN_CELLS`, `MAX_OFFERED_ICKB_CELLS`). The rest wait for later ones.
   */
  cells: ccc.Cell[];
  /**
   * The receipts the next transaction completes, the largest first, up to its share
   * (`MAX_OFFERED_RECEIPTS`), valued by the read.
   */
  receipts: ReceiptCell[];
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
  /**
   * Whether the next transaction has anything to collect: an available order, a receipt or a
   * ready withdrawal. A conversion of amount zero is that collection alone; with nothing to
   * collect it throws.
   */
  hasCollectable: boolean;
  /**
   * CKB in all the account's liquid cells, plain and iCKB alike, offered or not: what the
   * wallet shows, before the change cells, an order's master cell and the fee a
   * transaction must fund on top.
   */
  ckbNative: bigint;
  /** iCKB in all the account's native iCKB cells. */
  ickbNative: bigint;
  /**
   * `ckbNative` plus the CKB all the receipts, the ready withdrawals and the collectable
   * orders return.
   */
  ckbAvailable: bigint;
  /** `ickbNative` plus the iCKB all the receipts and the collectable orders return. */
  ickbAvailable: bigint;
  /**
   * The most CKB a CKB-to-iCKB conversion can always take: the CKB the next transaction is
   * offered (`cells`, `receipts`, the ready withdrawals and collectable orders) less the
   * cells and fee of an order-only conversion, the shape with the fewest cells to fund. A
   * Max button's amount; never negative, and below `ckbAvailable` also when the account
   * holds more than one transaction's share.
   */
  ckbConvertible: bigint;
  /**
   * The most iCKB an iCKB-to-CKB conversion can take: the iCKB the next transaction is
   * offered, in `cells`, `receipts` and the collectable orders. A Max button's amount.
   */
  ickbConvertible: bigint;
  /** `ckbAvailable` plus the CKB in pending withdrawals and orders. */
  ckbBalance: bigint;
  /** `ickbAvailable` plus the iCKB in pending orders. */
  ickbBalance: bigint;
  /** The latest date at which everything the wallet already has converting is collectable. */
  estimatedMaturity: bigint;
}

/** The sampled system: the part of the state that is the chain's, not the account's. */
export type SystemState = Pick<
  State,
  | "tip"
  | "feeRate"
  | "exchangeRatio"
  | "depositCapacity"
  | "orderBook"
  | "poolDeposits"
  | "lockUp"
  | "apyPercent"
>;
