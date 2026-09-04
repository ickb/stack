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
export {
  createPublicClient,
  publicRpcEndpointIdentity,
  verifyChainPreflight,
} from "./chain.ts";
export type {
  ChainPreflightEvidence,
  PublicRpcEndpointIdentity,
  SupportedChain,
} from "./chain.ts";
export { errnoCode, errorMessage, isRecord } from "./errors.ts";
export { formatCkb } from "./format.ts";
export {
  STOP_EXIT_CODE,
  jsonLogReplacer,
  logExecution,
  recordExecutionError,
  writeJsonLine,
} from "./logging.ts";
export type { JsonLogValue } from "./logging.ts";
export { firstSymlinkInPath } from "./path.ts";
export type { SymlinkPathDependencies } from "./path.ts";
export {
  minimalProcessEnv,
  runProcess,
  signalExitCode,
  timerDelayMs,
  withProcessSignalForwarding,
} from "./process.ts";
export type {
  ProcessChild,
  ProcessResult,
  ProcessRunnerDependencies,
  ProcessSignalContext,
  RunProcessOptions,
} from "./process.ts";
export {
  isRetryableCkbStateRaceError,
  isRetryableRpcResponseShapeError,
  isRetryableRpcTransportError,
} from "./retryable.ts";
export { parseRuntimeConfig, readRuntimeConfigEnv } from "./runtime_config.ts";
export type { RuntimeConfig } from "./runtime_config.ts";
