import { ccc } from "@ckb-ccc/core";

/**
 * The default upper limit on the number of cells to return when querying the chain.
 *
 * This limit is aligned with Nervos CKB's pull request #4576
 * (https://github.com/nervosnetwork/ckb/pull/4576) to avoid excessive paging.
 *
 * @remarks
 * When searching for cells, callers may override this limit
 * by passing a custom `limit` in their options. If no override is provided,
 * this constant controls how many cells will be fetched in a single batch.
 */
export const defaultFindCellsLimit = 400;

/**
 * Represents a transaction header that includes a block header and an optional transaction hash.
 */
export interface TransactionHeader {
  /**
   * The block header associated with the transaction, represented as `ccc.ClientBlockHeader`.
   */
  header: ccc.ClientBlockHeader;

  /**
   * An optional transaction hash associated with the transaction, represented as `ccc.Hex`.
   * This property may be undefined if the transaction hash is not applicable.
   */
  txHash?: ccc.Hex;
}

/**
 * Represents the components of a value, including CKB and UDT amounts.
 */
export interface ValueComponents {
  /** The CKB amount as a `ccc.FixedPoint`. */
  ckbValue: ccc.FixedPoint;

  /** The UDT amount as a `ccc.FixedPoint`. */
  udtValue: ccc.FixedPoint;
}

/**
 * Represents the exchange ratio between CKB and a UDT.
 * This interface is usually used in conjunction with `ValueComponents` to understand the values of entities.
 *
 * For example, if `v` implements `ValueComponents` and `r` is an `ExchangeRatio`:
 * - The absolute value of `v` is calculated as:
 *   `v.ckbValue * r.ckbScale + v.udtValue * r.udtScale`
 * - The equivalent CKB value of `v` is calculated as:
 *   `v.ckbValue + (v.udtValue * r.udtScale + r.ckbScale - 1n) / r.ckbScale`
 * - The equivalent UDT value of `v` is calculated as:
 *   `v.udtValue + (v.ckbValue * r.ckbScale + r.udtScale - 1n) / r.udtScale`
 */
export interface ExchangeRatio {
  /** The CKB scale as a `ccc.Num`. */
  ckbScale: ccc.Num;

  /** The UDT scale as a `ccc.Num`. */
  udtScale: ccc.Num;
}

/**
 * Interface representing the full configuration needed for interacting with a Script
 */
export interface ScriptDeps {
  /**
   * The script for which additional information is being provided.
   * @type {ccc.Script}
   */
  script: ccc.Script;

  /**
   * An array of cell dependencies associated with the script.
   * @type {ccc.CellDep[]}
   */
  cellDeps: ccc.CellDep[];
}

/**
 * Shuffles in-place an array using the Durstenfeld shuffle algorithm.
 * @link https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
 *
 * @param array - The array to shuffle.
 * @returns The same array containing the shuffled elements.
 */
export function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
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
 * @param n - The upper bound of the search range (exclusive).
 * @param f - A function that takes an index `i` and returns a boolean value.
 * @returns The smallest index `i` such that `f(i)` is true, or `n` if no such index exists.
 *
 * @credits go standard library authors, this implementation is just a translation:
 * https://go.dev/src/sort/search.go
 *
 * @example
 * // Example usage:
 * const isGreaterThanFive = (i: number) => i > 5;
 * const index = binarySearch(10, isGreaterThanFive); // Returns 6
 *
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
 * @param n - The upper bound of the search range (exclusive).
 * @param f - An async function that takes an index `i` and returns a boolean value.
 * @returns The smallest index `i` such that `f(i)` is true, or `n` if no such index exists.
 *
 * @credits go standard library authors, this implementation is just a translation or that code:
 * https://go.dev/src/sort/search.go *
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
 * @template T - The type of elements in the input iterable.
 * @param {AsyncIterable<T>} inputs - The asynchronous iterable to convert into an array.
 * @returns {Promise<T[]>} A promise that resolves to an array of elements.
 */
export async function collect<T>(inputs: AsyncIterable<T>): Promise<T[]> {
  const res = [];
  for await (const i of inputs) {
    res.push(i);
  }
  return res;
}

/**
 * A buffered generator that tries to maintain a fixed-size buffer of values.
 */
export class BufferedGenerator<T> {
  public buffer: T[] = [];

  /**
   * Creates an instance of Buffered.
   * @param generator - The generator to buffer values from.
   * @param maxSize - The maximum size of the buffer.
   */
  constructor(
    public generator: Generator<T, void, void>,
    public maxSize: number,
  ) {
    // Try to populate the buffer
    for (const value of generator) {
      this.buffer.push(value);
      if (this.buffer.length >= this.maxSize) {
        break;
      }
    }
  }

  /**
   * Advances the buffer by the specified number of steps.
   * @param n - The number of steps to advance the buffer.
   */
  public next(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.shift();
      const { value, done } = this.generator.next();
      if (!done) {
        this.buffer.push(value);
      }
    }
  }
}

/**
 * Returns the sum of a list of values.
 *
 * This function adds together an initial value with a variable number of additional values.
 * The operation is performed in a pairwise reduction manner to improve performance by reducing
 * the number of allocations, while achieving on numbers better numerical stability than naive summation.
 * It supports numbers (the main target) and bigints.
 *
 * @param res - The initial value used as the starting point for the sum.
 * @param rest - A variable number of additional values to be added.
 * @returns The sum of all provided values.
 *
 * @example
 * // Example usage with numbers:
 * const result = sum(1, 5, 3, 9, 2); // Returns 20
 *
 * @example
 * // Example usage with bigints:
 * const resultBigInt = sum(1n, 5n, 3n, 9n, 2n); // Returns 20n
 */
export function sum(res: number, ...rest: number[]): number;
export function sum(res: bigint, ...rest: bigint[]): bigint;
export function sum<T>(res: T, ...rest: T[]): T {
  const elements = [res, ...rest] as number[];
  let n = elements.length;

  // Perform pairwise reduction until a single value remains.
  while (n > 1) {
    const half = n >> 1;
    const isOdd = n % 2;
    // If there is an odd element, elements[half] is already in the correct place.
    for (let i = 0; i < half; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      elements[i]! += elements[n - i - 1]!;
    }
    n = half + isOdd;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return elements[0]! as T;
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
export function* unique<T extends ccc.Entity>(
  items: Iterable<T>,
): Generator<T> {
  const set = new Set<string>();
  for (const i of items) {
    const key = i.toHex();
    if (!set.has(key)) {
      set.add(key);
      yield i;
    }
  }
}
