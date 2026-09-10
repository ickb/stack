import type { ccc } from "@ckb-ccc/core";
import { IckbSdkL1 } from "./client/sdk_l1_class.ts";
import type {
  AccountState,
  BuildBaseTransactionOptions,
  CompleteIckbTransactionOptions,
  ConversionOrderEstimate,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  SdkManagers,
  SystemState,
} from "./client/sdk_types.ts";
import type { getConfig } from "./constants.ts";
import { estimate } from "./estimate/sdk_estimate.ts";
import type { Info, OrderGroup } from "./order/index.ts";
import type { ValueComponents } from "./utils/index.ts";
export { IckbError, isIckbError } from "./client/sdk_error.ts";
export type { IckbErrorCode } from "./client/sdk_error.ts";

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
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SdkManagers,
  SystemState,
} from "./client/sdk_types.ts";
export { DEFAULT_ORDER_FEE, DEFAULT_ORDER_FEE_BASE } from "./estimate/sdk_estimate.ts";
export {
  projectAccountAvailability,
  projectConversionTransactionContext,
} from "./estimate/sdk_projection.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type { WaitTransactionOptions } from "./send/wait_transaction.ts";

/** SDK for managing iCKB operations. @public */
export interface IckbSdk {
  /** Adds requested withdrawal, collection, receipt, and ready-withdrawal steps. */
  buildBaseTransaction(
    txLike: ccc.TransactionLike,
    options?: BuildBaseTransactionOptions,
  ): ccc.Transaction;
  /** Builds and completes a conversion, or returns a typed planning failure. */
  buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult>;
  /** Adds order-group inputs for collection or fulfilled-order cleanup. */
  collect(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction;
  /** Completes iCKB inputs and fees without signing or sending the transaction. */
  completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction>;
  /** Reads system, user-order, and account state against one sampled tip. */
  getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }>;
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
  /** Estimates one conversion order against the sampled system state. */
  public static estimate(
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: { fee?: ccc.Num; feeBase?: ccc.Num },
  ): ConversionOrderEstimate {
    return estimate(isCkb2Udt, amounts, system, options);
  }

  /**
   * Creates an SDK from a chain config object.
   */
  public static fromConfig(config: ReturnType<typeof getConfig>): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
      bots,
    } = config;

    return new IckbSdk({ ickbUdt, ownedOwner, ickbLogic: logic, order, bots });
  }
};

/** Concrete iCKB SDK constructor and static estimators. @public */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const IckbSdk: {
  new (managers: SdkManagers): IckbSdk;
  estimate: (
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: { fee?: ccc.Num; feeBase?: ccc.Num },
  ) => ConversionOrderEstimate;
  fromConfig: (config: ReturnType<typeof getConfig>) => IckbSdk;
} = IckbSdkImplementation;
