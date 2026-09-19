import type { ccc } from "@ckb-ccc/core";
import type {
  IckbDepositCell,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
  ReceiptCell,
  WithdrawalGroup,
} from "../core/index.ts";
import type { OrderCell, OrderGroup } from "../order/cells.ts";
import type { Info } from "../order/info.ts";
import type { OrderManager } from "../order/order.ts";
import type { Ratio } from "../order/ratio.ts";
import type { ValueComponents } from "../utils/index.ts";

/**
 * Direction requested by a conversion transaction.
 */
export type ConversionDirection = "ckb-to-ickb" | "ickb-to-ckb";

/**
 * Optional DAO readiness window for pool deposit scans.
 */
export interface PoolDepositRangeOptions {
  /** Optional lower bound for deposit renewal readiness. */
  minLockUp?: ccc.Epoch;

  /** Optional upper bound for deposit renewal readiness. */
  maxLockUp?: ccc.Epoch;
}

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
   * collectable; an amount of zero is the collection itself (decisions amendment 52(ai)).
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
   * cells along, so a lock that is not the signer's own moves everything liquid to it
   * (decisions amendment 52(af)).
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
 * Non-fatal conversion notice for callers to surface in UI or logs.
 */
export interface ConversionNotice {
  /** Notice category. */
  kind: "dust-ickb-to-ckb" | "maturity-unavailable";

  /** iCKB input amount that triggered the notice. */
  inputIckb: bigint;

  /** CKB output estimate for the noticed path. */
  outputCkb: bigint;

  /** CKB incentive associated with the noticed path. */
  incentiveCkb: bigint;

  /** True when maturity could not be estimated from available state. */
  maturityEstimateUnavailable: boolean;
}

/**
 * High-level conversion composition used by a built transaction.
 */
export interface ConversionMetadata {
  /** Composition category selected for the built conversion. */
  kind: "direct" | "order" | "direct-plus-order" | "collect-only";
}

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
      conversion: ConversionMetadata;
      /** Optional notice about the selected path. */
      conversionNotice?: ConversionNotice;
    }
  | {
      ok: false;
      /** Machine-readable failure reason. */
      reason: ConversionTransactionFailureReason;
      /** Best available maturity estimate from the input context. */
      estimatedMaturity: bigint;
      /**
       * For `amount-too-small`: the smallest amount this direction accepts at the current fee
       * rate, in the request's unit (CKB shannons or iCKB), so a caller can name it.
       */
      minimum?: bigint;
    };

/**
 * Options for completing a partial iCKB transaction before signing and sending.
 */
export interface CompleteIckbTransactionOptions {
  /** Signer that prepares the transaction; its recommended lock owns the change by default. */
  signer: ccc.Signer;

  /** Lock that owns the change, iCKB and plain, when not the signer's recommended lock. */
  lock?: ccc.Script;

  /** Fee rate passed to CCC fee completion. */
  feeRate: ccc.Num;

  /** The signer's known liquid cells, plain CKB and iCKB, from the account state already read. */
  cells: ccc.Cell[];
}

/**
 * Options for scanning L1 state.
 */
export interface GetL1StateOptions {
  /** Optional readiness window for public pool deposit scans. */
  poolDeposits?: PoolDepositRangeOptions;
}

/**
 * Quote details for one order-based conversion path.
 */
export interface ConversionOrderEstimate {
  /** Output amount after applying the order ratio and fee. */
  convertedAmount: ccc.FixedPoint;
  /** CKB fee component embedded in the order conversion. */
  ckbFee: ccc.FixedPoint;
  /** Order info that should be encoded into a created order. */
  info: Info;
  /** Estimated maturity timestamp, or `undefined` when it cannot be estimated. */
  maturity: ccc.Num | undefined;
  /** A non-fatal notice about the path this estimate took, for the caller to surface. */
  notice?: ConversionNotice;
}

/**
 * Input accepted by maturity estimation, either a live order cell or raw order data plus values.
 */
export type MaturityOrderInput =
  | OrderCell
  | {
      info: Info;
      amounts: ValueComponents;
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
   * fee it must fund on top (decisions amendment 52(ah)).
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
   * the DAO script addresses (`DAO_HEADER_INDEX_LIMIT`) left after the receipts' headers.
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
  /** Sampled tip used for this L1 scan. It may be stale after scans complete. */
  tip: ccc.ClientBlockHeader;
  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: Ratio;
  /** Every order past par on the book, the wallet's own included: what the bot can fill. */
  orderPool: OrderGroup[];
  /** The total available CKB (as FixedPoint). */
  ckbAvailable: ccc.FixedPoint;
  /** Array of CKB maturing entries with cumulative amounts and maturity timestamps. */
  ckbMaturing: CkbCumulative[];
  /** Every iCKB pool deposit, its readiness evaluated against this tip. */
  poolDeposits: IckbDepositCell[];
}

/**
 * Cumulative CKB maturity bucket used for maturity estimation.
 */
export interface CkbCumulative {
  /** The cumulative CKB value (as FixedPoint) up to this maturity. */
  ckbCumulative: ccc.FixedPoint;
  /** The maturity timestamp (as ccc.Num). */
  maturity: ccc.Num;
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

export interface ConversionOrder {
  amounts: ValueComponents;
  estimate: ConversionOrderEstimate;
}

export interface CkbToIckbConversionPlan {
  depositCapacity: bigint;
  depositCount: number;
  estimatedMaturity: bigint;
  order?: ConversionOrder;
}

export interface IckbToCkbConversionPlan {
  estimatedMaturity: bigint;
  order?: ConversionOrder;
  selectedDeposits: IckbDepositCell[];
}
