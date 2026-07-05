import type { ccc } from "@ckb-ccc/core";

/**
 * The default page size used when querying cells from the chain.
 *
 * This page size is aligned with Nervos CKB's pull request #4576
 * (https://github.com/nervosnetwork/ckb/pull/4576) to avoid excessive paging.
 *
 * @remarks
 * When searching for cells, callers may override this page size by passing a
 * custom `pageSize` in their options. This does not cap total results.
 *
 * @public
 */
export const defaultCellPageSize = 400;

/**
 * Collects every item yielded by a paged async scan.
 *
 * @remarks `pageSize` is passed to the supplied scan factory as an RPC/indexer
 * page size. It is not a total result cap.
 *
 * @public
 */
export async function collectPagedScan<T>(
  scan: (pageSize: number) => AsyncIterable<T>,
  options: {
    pageSize: number;
  },
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of scan(options.pageSize)) {
    results.push(item);
  }
  return results;
}

/**
 * Local transaction inclusion metadata.
 *
 * @public
 */
export interface TransactionHeader {
  /**
   * The block header used for inclusion-dependent calculations.
   */
  header: ccc.ClientBlockHeader;

  /**
   * The transaction hash when the caller has resolved it for the header.
   */
  txHash?: ccc.Hex;
}

/**
 * CKB and UDT amounts carried by a cell, order, or planned value.
 *
 * @public
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
 *
 * @public
 */
export interface ExchangeRatio {
  /** Numerator scale for CKB-side values. */
  ckbScale: ccc.Num;

  /** Numerator scale for UDT-side values. */
  udtScale: ccc.Num;
}

/**
 * Script plus cell dependencies needed to build transactions that use it.
 *
 * @public
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
 *
 * @public
 */
export function isPlainCapacityCell(cell: ccc.Cell): boolean {
  return cell.cellOutput.type === undefined && cell.outputData === "0x";
}

/**
 * Performs a binary search to find the smallest index `i` in the range [0, n)
 * such that the function `f(i)` returns true. It is assumed that for the range
 * [0, n), if `f(i)` is true, then `f(i+1)` is also true. This means that there
 * is a prefix of the input range where `f` is false, followed by a suffix where
 * `f` is true. If no such index exists, the function returns `n`.
 *
 * The function `f` is only called for indices in the range [0, n).
 *
 * @param n - The non-negative integer upper bound of the search range (exclusive).
 * @param f - A function that takes an index `i` and returns a boolean value.
 * @returns The smallest index `i` such that `f(i)` is true, or `n` if no such index exists.
 *
 * @remarks Adapted from Go's standard library search implementation:
 * {@link https://go.dev/src/sort/search.go}
 *
 * @example
 * `binarySearch(10, (i) => i > 5)` returns `6`.
 *
 * @public
 */
export function binarySearch(n: number, f: (i: number) => boolean): number {
  // Define f(-1) == false and f(n) == true.
  // Invariant: f(i-1) == false, f(j) == true.
  let [i, j] = [0, n];
  while (i < j) {
    const h = Math.trunc((i + j) / 2);
    // i ≤ h < j
    if (!f(h)) {
      i = h + 1; // preserves f(i-1) == false
    } else {
      j = h; // preserves f(j) == true
    }
  }
  // i == j, f(i-1) == false, and f(j) (= f(i)) == true  =>  answer is i.
  return i;
}

/**
 * Performs asynchronously a binary search to find the smallest index `i` in the range [0, n)
 * such that the function `f(i)` returns true. It is assumed that for the range
 * [0, n), if `f(i)` is true, then `f(i+1)` is also true. This means that there
 * is a prefix of the input range where `f` is false, followed by a suffix where
 * `f` is true. If no such index exists, the function returns `n`.
 *
 * The function `f` is only called for indices in the range [0, n).
 *
 * @param n - The non-negative integer upper bound of the search range (exclusive).
 * @param f - An async function that takes an index `i` and returns a boolean value.
 * @returns The smallest index `i` such that `f(i)` is true, or `n` if no such index exists.
 *
 * @remarks Adapted from Go's standard library search implementation:
 * {@link https://go.dev/src/sort/search.go}
 *
 * @public
 */
export async function asyncBinarySearch(
  n: number,
  f: (i: number) => Promise<boolean>,
): Promise<number> {
  // Define f(-1) == false and f(n) == true.
  // Invariant: f(i-1) == false, f(j) == true.
  let [i, j] = [0, n];
  while (i < j) {
    const h = Math.trunc((i + j) / 2);
    // i ≤ h < j
    if (!(await f(h))) {
      i = h + 1; // preserves f(i-1) == false
    } else {
      j = h; // preserves f(j) == true
    }
  }
  // i == j, f(i-1) == false, and f(j) (= f(i)) == true  =>  answer is i.
  return i;
}

/**
 * Converts an asynchronous iterable into an array.
 *
 * This function takes an `AsyncIterable<T>` as input and returns a promise that resolves
 * to an array containing all the elements yielded by the iterable.
 *
 * @typeParam T - The type of elements in the input iterable.
 * @param inputs - The asynchronous iterable to convert into an array.
 * @returns A promise that resolves to an array of elements.
 *
 * @public
 */
export async function collect<T>(inputs: AsyncIterable<T>): Promise<T[]> {
  const res = [];
  for await (const i of inputs) {
    res.push(i);
  }
  return res;
}

/**
 * Compares two bigint values using sort-compatible ordering.
 *
 * @returns `-1` when `left` is smaller, `1` when `left` is larger, and `0` when equal.
 *
 * @public
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
 * A buffered generator that tries to maintain a fixed-size buffer of values.
 *
 * @public
 */
export class BufferedGenerator<T> {
  /** Current buffered window of values. */
  public buffer: T[] = [];

  /** Wrapped generator that supplies future values. */
  public generator: Generator<T, void, void>;

  /** Target maximum number of buffered values. */
  public maxSize: number;

  /**
   * Creates a `BufferedGenerator` and fills the initial buffer.
   *
   * @param generator - The generator to buffer values from.
   * @param maxSize - The non-negative integer target maximum buffer size.
   */
  constructor(generator: Generator<T, void, void>, maxSize: number) {
    this.generator = generator;
    this.maxSize = maxSize;
    while (this.buffer.length < this.maxSize) {
      const { value, done } = this.generator.next();
      if (done === true) {
        break;
      }
      this.buffer.push(value);
    }
  }

  /**
   * Advances the buffer by discarding buffered values and reading replacements.
   *
   * @remarks
   * The buffer can shrink below `maxSize` once the wrapped generator is exhausted.
   *
   * @param n - The non-negative integer number of buffered positions to advance.
   */
  public next(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.shift();
      const { value, done } = this.generator.next();
      if (done !== true) {
        this.buffer.push(value);
      }
    }
  }
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
 *
 * @public
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
