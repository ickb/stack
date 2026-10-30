import { ccc } from "@ckb-ccc/core";
import { cccA } from "@ckb-ccc/core/advanced";

/**
 * The default page size used when querying cells from the chain.
 *
 * This page size is aligned with Nervos CKB's pull request #4576
 * (https://github.com/nervosnetwork/ckb/pull/4576) to avoid excessive paging.
 */
export const defaultCellPageSize = 400;

/**
 * A CCC client cache sized for a whole pool: 4096 headers and 4096 transaction bodies,
 * where CCC's defaults keep 128 and 256 (SDK README, Account state). An LRU fills only as
 * far as the book and pool need.
 */
export function clientCache(): ccc.ClientCacheMemory {
  return new ccc.ClientCacheMemory(512, 4096, 4096);
}

/** A committed cell and the block the node names for its creating transaction. */
export interface ScannedCell {
  cell: ccc.Cell;
  blockNumber: ccc.Num;
}

/**
 * Reads every committed cell matching the key with the block the node names for it, page
 * by page through the raw requestor (CCC's typed scan drops the block), bypassing CCC's
 * cell cache. A full page whose cursor does not advance throws. Why: SDK README, Account
 * state.
 */
export async function findCells(
  client: ccc.Client,
  keyLike: ccc.ClientIndexerSearchKeyLike,
): Promise<ScannedCell[]> {
  const requestor = jsonRpcRequestor(client);
  const key = cccA.JsonRpcTransformers.indexerSearchKeyFrom(keyLike);
  const cells: ScannedCell[] = [];
  let after: string | undefined;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- the node's indexer answer, parsed field by field below as CCC's own transformer does.
    const page = (await requestor.request("get_cells", [
      key,
      "asc",
      ccc.numToHex(defaultCellPageSize),
      after,
    ])) as RawCellsPage;
    for (const object of page.objects) {
      cells.push({
        cell: ccc.Cell.from({
          outPoint: cccA.JsonRpcTransformers.outPointTo(object.out_point),
          cellOutput: cccA.JsonRpcTransformers.cellOutputTo(object.output),
          outputData: object.output_data ?? "0x",
        }),
        blockNumber: ccc.numFrom(object.block_number),
      });
    }
    if (page.objects.length < defaultCellPageSize) {
      return cells;
    }
    if (page.last_cursor === after) {
      throw new Error("Cell scan cursor did not advance");
    }
    after = page.last_cursor;
  }
}

/** The headers of a batch of block numbers, each read once; every block must exist. */
export async function headersByNumber(
  client: ccc.Client,
  blockNumbers: Iterable<ccc.Num>,
): Promise<Map<ccc.Num, ccc.ClientBlockHeader>> {
  const distinct = [...new Set(blockNumbers)];
  const headers = await Promise.all(
    distinct.map(async (blockNumber) => client.getHeaderByNumber(blockNumber)),
  );
  return new Map(
    distinct.map((blockNumber, index) => {
      const header = headers[index];
      if (header === undefined) {
        throw new Error(`Header not found for block number ${String(blockNumber)}`);
      }
      return [blockNumber, header];
    }),
  );
}

/** The fields of the indexer's `get_cells` answer the scan reads. */
interface RawCellsPage {
  last_cursor: string;
  objects: Array<{
    out_point: cccA.JsonRpcOutPoint;
    output: cccA.JsonRpcCellOutput;
    output_data?: ccc.Hex;
    block_number: ccc.Hex;
  }>;
}

/**
 * CKB and UDT amounts carried by a cell, order, or planned value.
 */
export interface ValueComponents {
  /** CKB-side amount as a `ccc.FixedPoint`. */
  ckbValue: ccc.FixedPoint;

  /** UDT-side amount as a `ccc.FixedPoint`. */
  udtValue: ccc.FixedPoint;
}

/**
 * Integer scale pair for comparing or converting CKB-side and UDT-side values.
 *
 * @remarks
 * CKB-to-UDT conversions multiply by `ckbScale` and divide by `udtScale`.
 * UDT-to-CKB conversions swap the scales. Callers choose the rounding policy.
 */
export interface ExchangeRatio {
  /** Numerator scale for CKB-side values. */
  ckbScale: ccc.Num;

  /** Numerator scale for UDT-side values. */
  udtScale: ccc.Num;
}

/**
 * Script plus cell dependencies needed to build transactions that use it.
 */
export interface ScriptDeps {
  /**
   * The lock or type script.
   */
  script: ccc.Script;

  /**
   * Cell dependencies required to resolve the script code.
   */
  cellDeps: ccc.CellDep[];
}

/**
 * True when a cell has no type script and no data payload.
 *
 * @remarks
 * This is a structural filter for plain capacity cells. Spendability still
 * depends on the lock script, live cell state, and transaction context.
 */
export function isPlainCapacityCell(cell: ccc.Cell): boolean {
  return cell.cellOutput.type === undefined && cell.outputData === "0x";
}

/**
 * The client's JSON-RPC requestor, which the SDK's raw reads need: scans with block
 * numbers, status polls and transaction proofs. The connector hands the interface a
 * composition proxy over the public client (`ClientWithFeeRate`, a `ccc.Client` but not a
 * `ccc.ClientJsonRpc`), so `instanceof` misses it; the proxy forwards the property.
 */
export function jsonRpcRequestor(client: ccc.Client): ccc.RequestorJsonRpc {
  const requestor = "requestor" in client ? client.requestor : undefined;
  if (!(requestor instanceof ccc.RequestorJsonRpc)) {
    throw new TypeError("The SDK needs a JSON-RPC client");
  }
  return requestor;
}

/** `numerator / denominator` rounded up; the denominator is positive. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Compares two bigint values using sort-compatible ordering.
 *
 * @returns `-1` when `left` is smaller, `1` when `left` is larger, and `0` when equal.
 */
export function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

/**
 * Yields unique items from the given iterable based on their hex representation.
 *
 * The function uses a Set to track the hex-string keys of items that have already been yielded.
 * Only the first occurrence of each unique key is yielded.
 *
 * @typeParam T - A type that extends ccc.Entity.
 * @param items - An iterable collection of items of type T.
 * @returns A generator that yields items from the iterable, ensuring that each item's
 *          hex representation (via toHex()) is unique.
 */
export function* unique<T extends ccc.Entity>(items: Iterable<T>): Generator<T> {
  const set = new Set<string>();
  for (const i of items) {
    const key = i.toHex();
    if (!set.has(key)) {
      set.add(key);
      yield i;
    }
  }
}
