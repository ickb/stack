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
  MAX_WITHDRAWAL_REQUESTS,
  TransactionBroadcastError,
  TransactionWaitError,
  estimateMaturityFeeThreshold,
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
  GetPoolDepositsOptions,
  IckbErrorCode,
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SdkManagers,
  SystemState,
  WaitTransactionArguments,
  WaitTransactionOptions,
} from "./sdk.ts";
export {
  ringRequiredLiveDepositFor,
  ringSegmentAnchor,
  ringSegments,
  ringSurplusDepositFilter,
  ringTargetSegmentIndex,
  selectReadyWithdrawalDeposits,
} from "./withdrawal/withdrawal_selection.ts";
export type {
  ReadyWithdrawalSelection,
  ReadyWithdrawalSelectionOptions,
  RingSegment,
  WithdrawalDepositCandidate,
} from "./withdrawal/withdrawal_selection.ts";

export * from "./core/index.ts";
export * from "./dao/index.ts";
export * from "./order/index.ts";
export * from "./utils/index.ts";
