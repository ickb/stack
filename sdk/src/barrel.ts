/** Every public name of the SDK, which the entry exports flat and as `ickb`. */

import { readyAt as readyAtSampled } from "./conversion/projection.ts";
import type { State } from "./conversion/types.ts";
import type { ReceiptCell } from "./logic.ts";
import type { OrderGroup } from "./order/cells.ts";
import type { WithdrawalGroup } from "./owned_owner.ts";

/**
 * When a position the account holds is collectable, in unix milliseconds: `0n` or a time
 * at or before the tip means now.
 */
// The projection dates positions from the sampled system alone, before the State exists;
// the public signature takes the State, so the internal system type stays unexported.
export const readyAt: (
  position: OrderGroup | WithdrawalGroup | ReceiptCell,
  state: State,
) => bigint = readyAtSampled;

export { buildConversionTransaction } from "./build.ts";
export type { SupportedChain } from "./constants.ts";
export type {
  ConversionDirection,
  ConversionKind,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  State,
} from "./conversion/types.ts";
export type { BroadcastDeadline, LockUpPolicy } from "./dao.ts";
export type { IckbDepositCell, ReceiptCell } from "./logic.ts";
export type { MasterCell, OrderCell, OrderGroup } from "./order/cells.ts";
export {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  quoteConversion,
} from "./order/conversion.ts";
export type { QuoteConversionResult } from "./order/conversion.ts";
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
export { signAndSendTransaction } from "./send/sign_and_send_transaction.ts";
export type { SignAndSendTransactionResult } from "./send/sign_and_send_transaction.ts";
export { waitTransaction } from "./send/wait_transaction.ts";
export type {
  WaitTransactionOptions,
  WaitTransactionResult,
} from "./send/wait_transaction.ts";
export { readState } from "./state.ts";
export { ickbExchangeRatio } from "./udt.ts";
export { CACHE_SIZES } from "./utils/utils.ts";
export type { ExchangeRatio, ValueComponents } from "./utils/utils.ts";
