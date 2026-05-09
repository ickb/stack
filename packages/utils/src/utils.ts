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
 * True when a cell is plain spendable CKB capacity with no type script and no data payload.
 */
export function isPlainCapacityCell(cell: ccc.Cell): boolean {
  return cell.cellOutput.type === undefined && cell.outputData === "0x";
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
 * @credits go standard library authors, this implementation is just a translation of that code:
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

export function selectBoundedUdtSubset<T extends { udtValue: bigint }>(
  items: readonly T[],
  maxAmount: bigint,
  options: {
    candidateLimit: number;
    minCount: number;
    maxCount: number;
  },
): T[] {
  const { candidateLimit, minCount, maxCount } = options;
  const boundedItems = items.slice(0, candidateLimit);
  const effectiveMaxCount = Math.min(maxCount, boundedItems.length);
  if (
    maxAmount <= 0n ||
    minCount < 0 ||
    effectiveMaxCount < minCount ||
    boundedItems.length === 0
  ) {
    return [];
  }

  interface PartialSelection {
    mask: number;
    total: bigint;
  }

  const split = Math.floor(boundedItems.length / 2);
  const firstHalf = boundedItems.slice(0, split);
  const secondHalf = boundedItems.slice(split);
  assertBitmaskSearchSize(firstHalf.length);
  assertBitmaskSearchSize(secondHalf.length);

  const enumerate = (half: readonly T[]): PartialSelection[][] => {
    const groups = Array.from(
      { length: half.length + 1 },
      () => [] as PartialSelection[],
    );

    const search = (
      index: number,
      mask: number,
      count: number,
      total: bigint,
    ): void => {
      if (index === half.length) {
        groups[count]?.push({ mask, total });
        return;
      }

      search(index + 1, mask, count, total);

      const item = half[index];
      if (item === undefined) {
        return;
      }
      search(index + 1, mask | (1 << index), count + 1, total + item.udtValue);
    };

    search(0, 0, 0, 0n);
    return groups;
  };

  const firstByCount = enumerate(firstHalf);
  const secondByCount = enumerate(secondHalf).map((selections) =>
    compressSelections(selections, secondHalf.length)
  );

  let best:
    | {
        firstMask: number;
        secondMask: number;
        total: bigint;
      }
    | undefined;

  for (let firstCount = 0; firstCount <= effectiveMaxCount; firstCount += 1) {
    const firstSelections = firstByCount[firstCount] ?? [];
    for (const first of firstSelections) {
      if (first.total > maxAmount) {
        continue;
      }

      const minSecondCount = Math.max(0, minCount - firstCount);
      const maxSecondCount = effectiveMaxCount - firstCount;
      for (let secondCount = minSecondCount; secondCount <= maxSecondCount; secondCount += 1) {
        const secondSelections = secondByCount[secondCount] ?? [];
        const second = findBestAtOrBelow(secondSelections, maxAmount - first.total);
        if (!second) {
          continue;
        }

        const total = first.total + second.total;
        if (!best || total > best.total) {
          best = { firstMask: first.mask, secondMask: second.mask, total };
          continue;
        }

        if (total < best.total) {
          continue;
        }

        const firstCompare = compareMask(first.mask, best.firstMask, firstHalf.length);
        if (
          firstCompare < 0 ||
          (firstCompare === 0 &&
            compareMask(second.mask, best.secondMask, secondHalf.length) < 0)
        ) {
          best = { firstMask: first.mask, secondMask: second.mask, total };
        }
      }
    }
  }

  if (!best) {
    return [];
  }

  return selectByMasks(firstHalf, best.firstMask).concat(
    selectByMasks(secondHalf, best.secondMask),
  );
}

function assertBitmaskSearchSize(length: number): void {
  if (length > 30) {
    throw new Error("Bounded subset search supports at most 30 items per half");
  }
}

function compressSelections(
  selections: { mask: number; total: bigint }[],
  length: number,
): { mask: number; total: bigint }[] {
  selections.sort((left, right) => {
    const totalCompare = compareBigInt(left.total, right.total);
    if (totalCompare !== 0) {
      return totalCompare;
    }

    return compareMask(left.mask, right.mask, length);
  });

  const compressed: { mask: number; total: bigint }[] = [];
  for (const selection of selections) {
    if (compressed.at(-1)?.total !== selection.total) {
      compressed.push(selection);
    }
  }

  return compressed;
}

function findBestAtOrBelow<T extends { total: bigint }>(
  items: readonly T[],
  limit: bigint,
): T | undefined {
  let low = 0;
  let high = items.length - 1;
  let bestIndex = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const item = items[mid];
    if (item === undefined) {
      break;
    }

    if (item.total <= limit) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestIndex >= 0 ? items[bestIndex] : undefined;
}

function selectByMasks<T>(items: readonly T[], mask: number): T[] {
  const selected: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if ((mask & (1 << i)) !== 0) {
      const item = items[i];
      if (item !== undefined) {
        selected.push(item);
      }
    }
  }
  return selected;
}

function compareMask(left: number, right: number, length: number): number {
  for (let i = 0; i < length; i += 1) {
    const leftHas = (left & (1 << i)) !== 0;
    const rightHas = (right & (1 << i)) !== 0;
    if (leftHas === rightHas) {
      continue;
    }

    return leftHas ? -1 : 1;
  }

  return 0;
}

function compareBigInt(left: bigint, right: bigint): number {
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
    while (this.buffer.length < this.maxSize) {
      const { value, done } = this.generator.next();
      if (done) {
        break;
      }
      this.buffer.push(value);
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
