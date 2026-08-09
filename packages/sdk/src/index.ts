/**
 * Public SDK for planning, building, completing, and sending iCKB transactions.
 *
 * @packageDocumentation
 */

export { getConfig } from "./constants.ts";
export type { CodeScriptDeps, IckbDeploymentConfig } from "./constants.ts";
export {
  IckbSdk,
  MAX_WITHDRAWAL_REQUESTS,
  TransactionBroadcastError,
  TransactionWaitError,
  estimateMaturityFeeThreshold,
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
  IckbToCkbOrderEstimate,
  MaturityOrderInput,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
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
