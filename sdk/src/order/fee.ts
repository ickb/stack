import { ccc } from "@ckb-ccc/core";
import { ceilDiv } from "../utils/index.ts";
import type { OrderGroup } from "./cells.ts";

const CELL_INPUT_SERIALIZED_SIZE = 44;
// CellOutput table/script wrappers plus DynVec offset; output data Bytes plus offset.
const CELL_OUTPUT_SERIALIZATION_OVERHEAD = 60;
const OUTPUT_DATA_SERIALIZATION_OVERHEAD = 8;
// The supported SDK completion prepares a later signer witness, inserting one
// empty witness-vector entry for each preceding order input.
const EMPTY_WITNESS_SERIALIZATION_SIZE = 8;
const PREPARED_PARTIAL_SERIALIZATION_OVERHEAD =
  CELL_INPUT_SERIALIZED_SIZE +
  CELL_OUTPUT_SERIALIZATION_OVERHEAD +
  OUTPUT_DATA_SERIALIZATION_OVERHEAD +
  EMPTY_WITNESS_SERIALIZATION_SIZE;

/**
 * The mining fee one more matched order adds to a prepared transaction at the fee rate
 * (shannons per thousand bytes): its input, its replacement output with data, and its
 * empty witness, sized for the largest order of the pool.
 */
export function partialOrderFee(orderPool: OrderGroup[], feeRate: ccc.Num): bigint {
  const orderSize = orderPool.reduce(
    (largest, group) => Math.max(largest, group.order.cell.occupiedSize),
    0,
  );
  const bytes = ccc.numFrom(orderSize + PREPARED_PARTIAL_SERIALIZATION_OVERHEAD);
  return ceilDiv(bytes * feeRate, 1000n);
}
