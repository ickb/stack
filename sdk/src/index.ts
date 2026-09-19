/**
 * Public SDK for one iCKB conversion workflow: read the sampled state, quote, build and
 * complete a conversion, sign, send, and wait (decisions amendment 52).
 *
 * @packageDocumentation
 */

import type { ccc } from "@ckb-ccc/core";
import type {
  AccountState,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  SystemState,
} from "./conversion/types.ts";
import type { OrderGroup } from "./order/cells.ts";
import { IckbSdk as IckbSdkClass } from "./sdk.ts";
import type { SupportedChain } from "./utils/chain.ts";

/** The SDK an integrator drives: the state read and the conversion builder. */
export interface IckbSdk {
  /** Builds and completes a conversion, or returns a typed planning failure. */
  buildConversionTransaction: (
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ) => Promise<ConversionTransactionResult>;
  /** Reads system, user-order, and account state against one sampled tip. */
  getL1AccountState: (
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ) => Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }>;
}

/** Creates the SDK for one chain's deployment. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and the constructor namespace intentionally share a name.
export const IckbSdk: { fromChain: (chain: SupportedChain) => IckbSdk } = IckbSdkClass;

export { IckbError } from "./conversion/error.ts";
export type { IckbErrorCode } from "./conversion/error.ts";
export { DEFAULT_ORDER_FEE, DEFAULT_ORDER_FEE_BASE } from "./conversion/estimate.ts";
export { projectConversionTransactionContext } from "./conversion/projection.ts";
export type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionDirection,
  ConversionMetadata,
  ConversionNotice,
  ConversionTransactionContext,
  ConversionTransactionContextProjection,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  PoolDepositRangeOptions,
  SystemState,
} from "./conversion/types.ts";
export type { IckbDepositCell, ReceiptCell } from "./logic.ts";
export type { MasterCell, OrderCell, OrderGroup } from "./order/cells.ts";
export {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "./order/conversion.ts";
export { isRefused } from "./order/fill.ts";
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
export { hasTransactionActivity } from "./sdk.ts";
export { signerAccountLocks } from "./send/account_locks.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type { WaitTransactionOptions } from "./send/wait_transaction.ts";
export { ickbExchangeRatio } from "./udt.ts";
export type { SupportedChain } from "./utils/chain.ts";
export type { ExchangeRatio, TransactionHeader, ValueComponents } from "./utils/utils.ts";
