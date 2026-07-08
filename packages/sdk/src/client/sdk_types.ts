import type { ccc } from "@ckb-ccc/core";
import type {
  IckbDepositCell,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
  ReceiptCell,
  WithdrawalGroup,
} from "@ickb/core";
import type { Info, OrderCell, OrderGroup, OrderManager, Ratio } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";

export const MAX_DIRECT_DEPOSITS = 60;
export const MAX_WITHDRAWAL_REQUESTS = 30;
export const ORDER_MINT_OUTPUTS = 2;
export const CONVERSION_MATURITY_BUCKET_MS = 60n * 60n * 1000n;
export const NOTHING_TO_DO_REASON: ConversionTransactionFailureReason = "nothing-to-do";

/**
 * Direction requested by a conversion transaction.
 *
 * @public
 */
export type ConversionDirection = "ckb-to-ickb" | "ickb-to-ckb";

/**
 * Public pool deposit scan used by conversion planning.
 *
 * @public
 */
export interface PoolDepositState {
  /** All scanned iCKB pool deposits, with readiness evaluated against the sampled tip. */
  deposits: IckbDepositCell[];

  /** Ready deposits sorted for withdrawal planning. */
  readyDeposits: IckbDepositCell[];

  /** Opaque snapshot identity suitable for preview and cache keys. */
  id: string;
}

/**
 * Optional DAO readiness window for pool deposit scans.
 *
 * @public
 */
export interface PoolDepositRangeOptions {
  /** Optional lower bound for deposit renewal readiness. */
  minLockUp?: ccc.Epoch;

  /** Optional upper bound for deposit renewal readiness. */
  maxLockUp?: ccc.Epoch;
}

/**
 * Options for scanning public pool deposits.
 *
 * @public
 */
export interface GetPoolDepositsOptions extends PoolDepositRangeOptions {
  /** CCC cell pagination size. This is not a result cap. */
  cellPageSize?: number;
}

/**
 * Snapshot used to plan one wallet conversion transaction.
 *
 * @public
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
  /** Projected CKB available to the wallet after pending state is considered. */
  ckbAvailable: bigint;
  /** Projected iCKB available to the wallet after pending state is considered. */
  ickbAvailable: bigint;
  /** Best available maturity estimate for the requested conversion context. */
  estimatedMaturity: bigint;
}

/**
 * Inputs and policy limits for building one conversion transaction.
 *
 * @public
 */
export interface ConversionTransactionOptions {
  /** Conversion direction to build. */
  direction: ConversionDirection;

  /** Requested input amount in the source asset. */
  amount: bigint;

  /** User lock for newly created user-owned outputs. */
  lock: ccc.Script;

  /** State snapshot used to plan this conversion. */
  context: ConversionTransactionContext;

  /** Optional per-transaction planning limits. */
  limits?: {
    /** Maximum direct DAO deposits to create or request in one transaction. */
    maxDirectDeposits?: number;

    /** Maximum withdrawal requests to create in one transaction. */
    maxWithdrawalRequests?: number;
  };
}

/**
 * Reason a conversion transaction could not be built without throwing.
 *
 * @public
 */
export type ConversionTransactionFailureReason =
  | "amount-negative"
  | "insufficient-ckb"
  | "insufficient-ickb"
  | "amount-too-small"
  | "not-enough-ready-deposits"
  | "nothing-to-do";

/**
 * Non-fatal conversion notice for callers to surface in UI or logs.
 *
 * @public
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
 *
 * @public
 */
export interface ConversionMetadata {
  /** Composition category selected for the built conversion. */
  kind: "direct" | "order" | "direct-plus-order" | "collect-only";
}

/**
 * Result of attempting to build a conversion transaction.
 *
 * @public
 */
export type ConversionTransactionResult =
  | {
      ok: true;
      /** Partial transaction. Callers still own iCKB completion, fee completion, signing, and send. */
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
    };

/**
 * Options for completing a partial iCKB transaction before signing and sending.
 *
 * @public
 */
export interface CompleteIckbTransactionOptions {
  /** Signer used for iCKB input completion and fee completion. */
  signer: ccc.Signer;

  /** Client used for final transaction safety checks. */
  client: ccc.Client;

  /** Fee rate passed to CCC fee completion. */
  feeRate: ccc.Num;
}

/**
 * Options for scanning the L1 state snapshot.
 *
 * @public
 */
export interface GetL1StateOptions {
  /** CCC cell pagination size for each scan. This is not a result cap. */
  cellPageSize?: number;

  /** Optional readiness window for public pool deposit scans. */
  poolDeposits?: PoolDepositRangeOptions;
}

/**
 * Estimate for the order leg of an iCKB-to-CKB conversion.
 *
 * @public
 */
export interface IckbToCkbOrderEstimate {
  /** Order conversion estimate for the market leg. */
  estimate: ConversionOrderEstimate;
  /** Estimated maturity for the output CKB, or `undefined` when unavailable. */
  maturity: bigint | undefined;
  /** Optional non-fatal notice associated with the estimate. */
  notice?: ConversionNotice;
}

/**
 * Quote details for one order-based conversion path.
 *
 * @public
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
}

/**
 * Input accepted by maturity estimation, either a live order cell or raw order data plus values.
 *
 * @public
 */
export type MaturityOrderInput =
  | OrderCell
  | {
      info: Info;
      amounts: ValueComponents;
    };

/**
 * Raw wallet-owned cells and grouped iCKB state sampled from L1.
 *
 * @public
 */
export interface AccountState {
  /** Plain capacity cells owned by the account locks. */
  capacityCells: ccc.Cell[];
  /** Native iCKB xUDT cells owned by the account locks. */
  nativeUdtCells: ccc.Cell[];
  /** Total capacity in native iCKB cells. */
  nativeUdtCapacity: bigint;
  /** Total iCKB balance in native iCKB cells. */
  nativeUdtBalance: bigint;
  /** Receipt cells owned by the account. */
  receipts: ReceiptCell[];
  /** Withdrawal groups owned by the account. */
  withdrawalGroups: WithdrawalGroup[];
}

/**
 * Account balances split into available, pending, and order/withdrawal buckets.
 *
 * @public
 */
export interface AccountAvailabilityProjection {
  /** Native CKB directly controlled by the account. */
  ckbNative: bigint;
  /** Native iCKB directly controlled by the account. */
  ickbNative: bigint;
  /** CKB available for new conversion inputs. */
  ckbAvailable: bigint;
  /** iCKB available for new conversion inputs. */
  ickbAvailable: bigint;
  /** CKB pending in withdrawals or orders. */
  ckbPending: bigint;
  /** iCKB pending in withdrawals or orders. */
  ickbPending: bigint;
  /** Total CKB balance including pending positions. */
  ckbBalance: bigint;
  /** Total iCKB balance including pending positions. */
  ickbBalance: bigint;
  /** Withdrawal groups ready to complete. */
  readyWithdrawals: WithdrawalGroup[];
  /** Withdrawal groups still waiting for DAO maturity. */
  pendingWithdrawals: WithdrawalGroup[];
  /** Order groups available for collection or budgeting as account value. */
  availableOrders: OrderGroup[];
  /** Order groups that are owned but unavailable or unresolved. */
  pendingOrders: OrderGroup[];
}

/**
 * Combined projection and transaction-planning context for one account snapshot.
 *
 * @public
 */
export interface ConversionTransactionContextProjection {
  /** User-facing availability projection. */
  projection: AccountAvailabilityProjection;
  /** Builder-facing transaction context derived from the same snapshot. */
  context: ConversionTransactionContext;
}

/**
 * Public system snapshot used for quotes, maturity, and conversion planning.
 *
 * @public
 */
export interface SystemState {
  /** The fee rate for transactions. */
  feeRate: ccc.Num;
  /** Sampled tip used for this L1 scan. It may be stale after scans complete. */
  tip: ccc.ClientBlockHeader;
  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: Ratio;
  /** The order pool containing order cells matching system criteria. */
  orderPool: OrderCell[];
  /** The total available CKB (as FixedPoint). */
  ckbAvailable: ccc.FixedPoint;
  /** Array of CKB maturing entries with cumulative amounts and maturity timestamps. */
  ckbMaturing: CkbCumulative[];
  /** Public pool deposit scan evaluated against this tip for conversion planning. */
  poolDeposits?: PoolDepositState;
}

/**
 * Cumulative CKB maturity bucket used for maturity estimation.
 *
 * @public
 */
export interface CkbCumulative {
  /** The cumulative CKB value (as FixedPoint) up to this maturity. */
  ckbCumulative: ccc.FixedPoint;
  /** The maturity timestamp (as ccc.Num). */
  maturity: ccc.Num;
}

export interface SdkManagers {
  ickbUdt: IckbUdt;
  ownedOwner: OwnedOwnerManager;
  ickbLogic: LogicManager;
  order: OrderManager;
  bots: ccc.Script[];
}

/**
 * Optional components to collect into a base iCKB transaction.
 *
 * @public
 */
export interface BuildBaseTransactionOptions {
  /** DAO withdrawal request inputs/outputs to add before other collect steps. */
  withdrawalRequest?: {
    /** Deposits to spend into owned withdrawal requests. */
    deposits: IckbDepositCell[];

    /** Live pool deposits to add as cell deps without spending them. */
    requiredLiveDeposits?: IckbDepositCell[];

    /** User lock for owner marker outputs. */
    lock: ccc.Script;
  };

  /** Fulfilled or selected order groups to melt. */
  orders?: OrderGroup[];

  /** Receipt cells to spend for deposit completion. */
  receipts?: ReceiptCell[];

  /** Ready owned withdrawal groups to complete. */
  readyWithdrawals?: WithdrawalGroup[];
}

export interface ConversionOrder {
  amounts: ValueComponents;
  estimate: ConversionOrderEstimate;
  conversionNotice?: ConversionNotice;
}

export interface CkbToIckbConversionPlan {
  depositCapacity: bigint;
  depositCount: number;
  estimatedMaturity: bigint;
  order?: ConversionOrder;
}

export interface IckbToCkbConversionPlan {
  directSurplusCkb: bigint;
  directUdtValue: bigint;
  estimatedMaturity: bigint;
  order?: ConversionOrder;
  requiredLiveDeposits: IckbDepositCell[];
  selectedDeposits: IckbDepositCell[];
}

export interface MaturingCkb {
  ckbValue: ccc.FixedPoint;
  maturity: ccc.Num;
}

export interface CkbProjection {
  ready: ccc.FixedPoint;
  maturing: MaturingCkb[];
}
