/**
 * Shared Node.js runtime helpers for iCKB apps.
 *
 * @packageDocumentation
 */

export {
  accountPlainCkbBalance,
  postTransactionAccountPlainCkbBalance,
  signerAccountLocks,
} from "./account.ts";
export { createPublicClient, verifyChainPreflight } from "./chain.ts";
export type { ChainPreflightEvidence, SupportedChain } from "./chain.ts";
export { formatCkb } from "./format.ts";
export {
  STOP_EXIT_CODE,
  handleLoopError,
  jsonLogReplacer,
  logExecution,
  writeJsonLine,
} from "./logging.ts";
export type { JsonLogValue } from "./logging.ts";
export {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
} from "./retryable.ts";
export {
  parseRuntimeConfig,
  randomSleepIntervalMs,
  reachedMaxIterations,
  readRuntimeConfigEnv,
  sleep,
} from "./runtime_config.ts";
export type { RuntimeConfig } from "./runtime_config.ts";
