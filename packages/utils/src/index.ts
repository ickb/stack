/**
 * Shared utility codecs, collection helpers, and value shapes used by iCKB Stack packages.
 *
 * @packageDocumentation
 */

export { expectedChainIdentity } from "./chain.ts";
export type { ChainIdentity, SupportedChain } from "./chain.ts";
export {
  CheckedInt32LE,
  CheckedUint128LE,
  CheckedUint32LE,
  CheckedUint64LE,
  CheckedUint8,
} from "./codec.ts";
export {
  PagedScanBudget,
  PagedScanBudgetError,
  PagedScanCursorError,
  asyncBinarySearch,
  binarySearch,
  collect,
  collectCellsPaged,
  collectPagedScan,
  compareBigInt,
  defaultCellPageSize,
  defaultScanBudget,
  defaultScanItemLimit,
  findSignerCellsPagedNoCache,
  isPlainCapacityCell,
  pagedScanCursorErrorCode,
  unique,
} from "./utils.ts";
export type {
  ExchangeRatio,
  PagedScanBudgetReason,
  PagedScanPage,
  PagedScanSignal,
  ScriptDeps,
  TransactionHeader,
  ValueComponents,
} from "./utils.ts";
