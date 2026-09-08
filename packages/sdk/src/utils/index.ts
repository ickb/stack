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
  asyncBinarySearch,
  binarySearch,
  collect,
  compareBigInt,
  defaultCellPageSize,
  findCells,
  findSignerCells,
  isPlainCapacityCell,
  unique,
} from "./utils.ts";
export type {
  ExchangeRatio,
  ScriptDeps,
  TransactionHeader,
  ValueComponents,
} from "./utils.ts";
