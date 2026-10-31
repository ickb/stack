/**
 * Public SDK for one iCKB conversion workflow: read the sampled state, quote, build and
 * complete a conversion, sign, send, and wait.
 *
 * @packageDocumentation
 */

import type { ccc } from "@ckb-ccc/core";
import type { SupportedChain } from "./constants.ts";
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

/** Creates the SDK for one chain's deployment. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and the constructor namespace intentionally share a name.
export const IckbSdk: { fromChain: (chain: SupportedChain) => IckbSdk } = IckbSdkClass;

export type { SupportedChain } from "./constants.ts";
export { DEFAULT_ORDER_FEE, DEFAULT_ORDER_FEE_BASE } from "./conversion/estimate.ts";
export { projectConversionTransactionContext } from "./conversion/projection.ts";
export type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionDirection,
  ConversionKind,
  ConversionNotice,
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
export { IckbError } from "./sdk.ts";
export type { IckbErrorCode } from "./sdk.ts";
export {
  signAndSendTransaction,
  TransactionBroadcastError,
  TransactionExpiredError,
} from "./send/sign_and_send_transaction.ts";
export { TransactionWaitError, waitTransaction } from "./send/wait_transaction.ts";
export type { WaitTransactionOptions } from "./send/wait_transaction.ts";
export { ickbExchangeRatio } from "./udt.ts";
export { signerAccountLocks } from "./utils/signer.ts";
export { clientCache } from "./utils/utils.ts";
export type { ExchangeRatio, ValueComponents } from "./utils/utils.ts";
