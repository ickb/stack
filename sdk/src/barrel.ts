/** Every public name of the SDK, which the entry exports flat and as `ickb`. */

import type { ccc } from "@ckb-ccc/core";
import type {
  AccountState,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  SystemState,
} from "./conversion/types.ts";
import type { LockUpPolicy } from "./dao.ts";
import type { OrderGroup } from "./order/cells.ts";
import { IckbSdk as IckbSdkClass } from "./sdk.ts";

/** The SDK an integrator drives: the state read and the conversion builder. */
export interface IckbSdk {
  /** Builds and completes a conversion, or returns a typed planning failure. */
  buildConversionTransaction: (
    options: ConversionTransactionOptions,
  ) => Promise<ConversionTransactionResult>;
  /** Reads system, user-order, and account state at the sampled tip's parent, under one timing policy. */
  getL1AccountState: (
    client: ccc.Client,
    locks: ccc.Script[],
    lockUp: LockUpPolicy,
    maxFeeRate?: ccc.NumLike,
  ) => Promise<{
    system: SystemState;
    userOrders: OrderGroup[];
    account: AccountState;
  }>;
}

/** Creates the SDK: one serves every supported chain, which completion reads from the signer's client. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and the constructor intentionally share a name.
export const IckbSdk: new () => IckbSdk = IckbSdkClass;

export { IckbError } from "./complete.ts";
export type { IckbErrorCode } from "./complete.ts";
export type { SupportedChain } from "./constants.ts";
export { projectConversionTransactionContext, readyAt } from "./conversion/projection.ts";
export type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionDirection,
  ConversionKind,
  ConversionTransactionContext,
  ConversionTransactionContextProjection,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  SystemState,
} from "./conversion/types.ts";
export { WALLET_LOCK_UP } from "./dao.ts";
export type { BroadcastDeadline, LockUpPolicy } from "./dao.ts";
export type { IckbDepositCell, ReceiptCell } from "./logic.ts";
export type { MasterCell, OrderCell, OrderGroup } from "./order/cells.ts";
export {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "./order/conversion.ts";
export type { Info, InfoLike } from "./order/info.ts";
export type { Master, MasterLike } from "./order/master.ts";
export type { OrderData, OrderDataLike } from "./order/order_data.ts";
export { Ratio } from "./order/ratio.ts";
export type { Relative, RelativeLike } from "./order/relative.ts";
export type {
  DaoWithdrawalRequestCell,
  OwnerCell,
  WithdrawalGroup,
} from "./owned_owner.ts";
export { hasCollectable } from "./sdk.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
  TransactionExpiredError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type { WaitTransactionOptions } from "./send/wait_transaction.ts";
export { ickbExchangeRatio } from "./udt.ts";
export { signerAccountLocks } from "./utils/signer.ts";
export { CACHE_SIZES } from "./utils/utils.ts";
export type { ExchangeRatio, ValueComponents } from "./utils/utils.ts";
