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
  handleLoopError,
  jsonLogReplacer,
  logExecution,
  writeJsonLine,
} from "./logging.ts";
export type { JsonLogValue } from "./logging.ts";
export { firstSymlinkInPath } from "./path.ts";
export type { SymlinkPathDependencies } from "./path.ts";
export {
  ProcessSignalError,
  minimalProcessEnv,
  readLinuxProcessIdentity,
  runProcess,
  signalExitCode,
  timerDelayMs,
  withProcessSignalForwarding,
} from "./process.ts";
export type {
  LinuxProcessIdentity,
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
export {
  parseRuntimeConfig,
  randomSleepIntervalMs,
  reachedMaxIterations,
  readRuntimeConfigEnv,
  sleep,
} from "./runtime_config.ts";
export type { RuntimeConfig } from "./runtime_config.ts";
