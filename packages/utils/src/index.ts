/**
 * Shared utility codecs, collection helpers, and value shapes used by iCKB Stack packages.
 *
 * @packageDocumentation
 */

export { CheckedInt32LE } from "./codec.ts";
export {
  BufferedGenerator,
  asyncBinarySearch,
  binarySearch,
  collect,
  collectPagedScan,
  compareBigInt,
  defaultCellPageSize,
  isPlainCapacityCell,
  unique,
} from "./utils.ts";
export type {
  ExchangeRatio,
  ScriptDeps,
  TransactionHeader,
  ValueComponents,
} from "./utils.ts";
