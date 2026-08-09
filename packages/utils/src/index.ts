/**
 * Shared utility codecs, collection helpers, and value shapes used by iCKB Stack packages.
 *
 * @packageDocumentation
 */

export {
  CheckedInt32LE,
  CheckedUint128LE,
  CheckedUint32LE,
  CheckedUint64LE,
  CheckedUint8,
} from "./codec.ts";
export {
  PagedScanCursorError,
  asyncBinarySearch,
  binarySearch,
  collect,
  collectCellsPaged,
  collectPagedScan,
  compareBigInt,
  defaultCellPageSize,
  isPlainCapacityCell,
  pagedScanCursorErrorCode,
  unique,
} from "./utils.ts";
export type {
  ExchangeRatio,
  PagedScanPage,
  ScriptDeps,
  TransactionHeader,
  ValueComponents,
} from "./utils.ts";
