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
} from "./conversion/sdk_types.ts";
import type { OrderGroup } from "./order/model/cells.ts";
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
export type { AccountAvailabilityProjection } from "./conversion/sdk_types.ts";
export type {
  IckbDepositCell,
  OwnerCell,
  ReceiptCell,
  WithdrawalGroup,
} from "./core/cells.ts";
export type { DaoDepositCell, DaoWithdrawalRequestCell } from "./core/dao_cells.ts";
export type { MasterCell, OrderCell, OrderGroup } from "./order/model/cells.ts";
export type { Info, InfoLike } from "./order/model/info.ts";
export type { Master, MasterLike } from "./order/model/master.ts";
export type { OrderData, OrderDataLike } from "./order/model/order_data.ts";
export type { Relative, RelativeLike } from "./order/model/relative.ts";
export type { ExchangeRatio, TransactionHeader, ValueComponents } from "./utils/utils.ts";

export { signerAccountLocks } from "./conversion/account_locks.ts";
export { IckbError, isIckbError } from "./conversion/sdk_error.ts";
export type { IckbErrorCode } from "./conversion/sdk_error.ts";
export { DEFAULT_ORDER_FEE, DEFAULT_ORDER_FEE_BASE } from "./conversion/sdk_estimate.ts";
export { projectConversionTransactionContext } from "./conversion/sdk_projection.ts";
export type {
  AccountState,
  CkbCumulative,
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
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./conversion/sdk_types.ts";
export { ickbExchangeRatio } from "./core/udt.ts";
export {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "./order/matching/order_conversion.ts";
export { Ratio } from "./order/model/ratio.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type { WaitTransactionOptions } from "./send/wait_transaction.ts";
export type { SupportedChain } from "./utils/chain.ts";
