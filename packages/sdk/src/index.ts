/**
 * Public SDK for planning, building, completing, and sending iCKB transactions.
 *
 * @packageDocumentation
 */

export { getConfig } from "./constants.ts";
export {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  IckbError,
  IckbSdk,
  TransactionBroadcastError,
  TransactionWaitError,
  isIckbError,
  projectAccountAvailability,
  projectConversionTransactionContext,
  signAndSendTransaction,
  waitTransaction,
} from "./sdk.ts";
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
  IckbErrorCode,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SdkManagers,
  SystemState,
  WaitTransactionOptions,
} from "./sdk.ts";
export { completeFirstFundable } from "./withdrawal/withdrawal_completion.ts";
export type { FundableCompletion } from "./withdrawal/withdrawal_completion.ts";
export {
  ringSegmentAnchor,
  ringSegments,
  ringSurplusDepositFilter,
  ringTargetSegmentIndex,
  selectReadyWithdrawalDeposits,
} from "./withdrawal/withdrawal_selection.ts";
export type {
  ReadyWithdrawalSelectionOptions,
  RingSegment,
  WithdrawalDepositCandidate,
} from "./withdrawal/withdrawal_selection.ts";

export {
  accountPlainCkbBalance,
  postTransactionAccountPlainCkbBalance,
  signerAccountLocks,
} from "./account/account_locks.ts";
export * from "./core/index.ts";
export * from "./dao/index.ts";
export * from "./order/index.ts";
export * from "./utils/index.ts";
