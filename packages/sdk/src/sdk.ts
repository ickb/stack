import type { ccc } from "@ckb-ccc/core";
import type { IckbUdt, LogicManager, OwnedOwnerManager } from "@ickb/core";
import type { Info, OrderGroup, OrderManager } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import { IckbSdkL1 } from "./client/sdk_l1_class.ts";
import type {
  AccountState,
  BuildBaseTransactionOptions,
  CompleteIckbTransactionOptions,
  ConversionOrderEstimate,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  GetPoolDepositsOptions,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositState,
  SystemState,
} from "./client/sdk_types.ts";
import type { getConfig } from "./constants.ts";
import { estimate, estimateIckbToCkbOrder } from "./estimate/sdk_estimate.ts";
import { maturity } from "./estimate/sdk_maturity.ts";
export { IckbError, isIckbError } from "./client/sdk_error.ts";
export type { IckbErrorCode } from "./client/sdk_error.ts";

export { MAX_WITHDRAWAL_REQUESTS } from "./client/sdk_types.ts";
export type {
  AccountAvailabilityProjection,
  AccountState,
  BuildBaseTransactionOptions,
  CkbCumulative,
  CompleteIckbTransactionOptions,
  ConversionDirection,
  ConversionMetadata,
  ConversionNotice,
  ConversionOrderEstimate,
  ConversionTransactionContext,
  ConversionTransactionContextProjection,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  GetPoolDepositsOptions,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./client/sdk_types.ts";
export {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  estimateMaturityFeeThreshold,
} from "./estimate/sdk_estimate.ts";
export {
  projectAccountAvailability,
  projectConversionTransactionContext,
} from "./estimate/sdk_projection.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type {
  WaitTransactionArguments,
  WaitTransactionOptions,
} from "./send/wait_transaction.ts";

/** SDK for managing iCKB operations. @public */
export interface IckbSdk {
  /** Adds requested withdrawal, collection, receipt, and ready-withdrawal steps. */
  buildBaseTransaction(
    txLike: ccc.TransactionLike,
    options?: BuildBaseTransactionOptions,
  ): ccc.Transaction;
  /** Builds a partial conversion or returns a typed planning failure. */
  buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult>;
  /** Adds order-group inputs for collection or fulfilled-order cleanup. */
  collect(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: { isFulfilledOnly?: boolean },
  ): ccc.Transaction;
  /** Completes iCKB inputs and fees without signing or sending the transaction. */
  completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction>;
  /** Scans wallet-owned cells, evaluating withdrawal readiness at `tip`. */
  getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
    options?: { cellPageSize?: number; signal?: AbortSignal },
  ): Promise<AccountState>;
  /** Returns sampled system, user-order, and account state from best-effort scans. */
  getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }>;
  /** Samples system state and partitions user orders from the public order pool. */
  getL1State(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }>;
  /** Scans public pool deposits and evaluates readiness against `tip`. */
  getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: GetPoolDepositsOptions,
  ): Promise<PoolDepositState>;
  /** Adds a user-owned order request, deriving its lock from a signer when needed. */
  request(
    txLike: ccc.TransactionLike,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<ccc.Transaction>;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const IckbSdkImplementation = class IckbSdk extends IckbSdkL1 {
  /** Creates an SDK from resolved protocol managers and bot lock scripts. */
  constructor(
    ...[ickbUdt, ownedOwner, ickbLogic, order, bots]: [
      ickbUdt: IckbUdt,
      ownedOwner: OwnedOwnerManager,
      ickbLogic: LogicManager,
      order: OrderManager,
      bots: ccc.Script[],
    ]
  ) {
    super({
      ickbUdt,
      ownedOwner,
      ickbLogic,
      order,
      bots,
    });
  }

  /** Estimates one conversion order against the sampled system state. */
  public static estimate(
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: { fee?: ccc.Num; feeBase?: ccc.Num },
  ): ConversionOrderEstimate {
    return estimate(isCkb2Udt, amounts, system, options);
  }

  /** Estimates the order path for an iCKB-to-CKB conversion when one is available. */
  public static estimateIckbToCkbOrder(
    amounts: ValueComponents,
    system: SystemState,
  ): IckbToCkbOrderEstimate | undefined {
    return estimateIckbToCkbOrder(amounts, system);
  }

  /**
   * Creates an SDK from a chain config object.
   */
  public static fromConfig(config: ReturnType<typeof getConfig>): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
      bots,
    } = config;

    return new IckbSdk(ickbUdt, ownedOwner, logic, order, bots);
  }

  /** Estimates maturity for an order input from the sampled system state. */
  public static maturity(o: MaturityOrderInput, system: SystemState): bigint | undefined {
    return maturity(o, system);
  }
};

/** Concrete iCKB SDK constructor and static estimators. @public */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const IckbSdk: {
  new (
    ickbUdt: IckbUdt,
    ownedOwner: OwnedOwnerManager,
    ickbLogic: LogicManager,
    order: OrderManager,
    bots: ccc.Script[],
  ): IckbSdk;
  estimate: (
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: { fee?: ccc.Num; feeBase?: ccc.Num },
  ) => ConversionOrderEstimate;
  estimateIckbToCkbOrder: (
    amounts: ValueComponents,
    system: SystemState,
  ) => IckbToCkbOrderEstimate | undefined;
  fromConfig: (config: ReturnType<typeof getConfig>) => IckbSdk;
  maturity: (o: MaturityOrderInput, system: SystemState) => bigint | undefined;
} = IckbSdkImplementation;
