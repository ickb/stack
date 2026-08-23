import { ccc } from "@ckb-ccc/core";

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
 * A page returned to {@link collectPagedScan}.
 *
 * @public
 */
export type PagedScanPage<T> =
  | { items: readonly T[]; lastCursor?: string }
  | { cells: readonly T[]; lastCursor?: string };

/**
 * Stable error code for a full page that cannot advance pagination.
 *
 * @public
 */
export const pagedScanCursorErrorCode = "PAGED_SCAN_CURSOR_NOT_ADVANCING";

/**
 * Raised when a full page omits its next cursor or repeats a cursor in the scan.
 *
 * @public
 */
export class PagedScanCursorError extends Error {
  /** Machine-readable stable error code. */
  public readonly code = pagedScanCursorErrorCode;

  /** Cursor supplied to the failed page request. */
  public readonly previousCursor: string | undefined;

  /** Cursor returned by the failed page request. */
  public readonly lastCursor: string | undefined;

  /** Creates a cursor-progress error for one failed page. */
  constructor(
    progress: { previousCursor: string | undefined; lastCursor: string | undefined },
    options?: ErrorOptions,
  ) {
    super("Paged scan returned a full page without an advancing lastCursor", options);
    this.name = "PagedScanCursorError";
    this.previousCursor = progress.previousCursor;
    this.lastCursor = progress.lastCursor;
  }
}

/** Why a bounded paged scan stopped before returning complete results. @public */
export type PagedScanBudgetReason = "items" | "pages" | "aborted";

/** Minimal cancellation signal accepted by the browser-safe scan collector. @public */
export interface PagedScanSignal {
  /** Whether cancellation has been requested. */
  readonly aborted: boolean;
  /** Caller-owned cancellation reason, when one was supplied. */
  readonly reason?: unknown;
}

/** Raised when a shared paged-scan budget is exhausted or aborted. @public */
export class PagedScanBudgetError extends Error {
  /** Limit that stopped the scan. */
  public readonly reason: PagedScanBudgetReason;

  /** Number of items accepted before the failure. */
  public readonly items: number;

  /** Number of page requests started before the failure. */
  public readonly pages: number;

  /** Creates a scan-budget failure from the current budget counters. */
  constructor(
    message: string,
    options: ErrorOptions & {
      reason: PagedScanBudgetReason;
      items: number;
      pages: number;
    },
  ) {
    super(message, options);
    this.name = "PagedScanBudgetError";
    this.reason = options.reason;
    this.items = options.items;
    this.pages = options.pages;
  }
}

/** Shared aggregate budget for one logical scan composed of several page collectors. @public */
export class PagedScanBudget {
  private items = 0;
  private pages = 0;
  private readonly maxItems: number;
  private readonly maxPages: number;
  private readonly signal: PagedScanSignal | undefined;

  /** Creates a fixed aggregate budget. */
  constructor(maxItems: number, maxPages: number, signal?: PagedScanSignal) {
    assertPositiveSafeInteger(maxItems, "maxItems");
    assertPositiveSafeInteger(maxPages, "maxPages");
    this.maxItems = maxItems;
    this.maxPages = maxPages;
    this.signal = signal;
  }

  /** Charges one page request before it starts. */
  public startPage(): void {
    this.assertActive();
    if (this.pages >= this.maxPages) {
      throw this.error("pages");
    }
    this.pages += 1;
  }

  /** Charges returned items before the caller can observe partial results. */
  public addItems(count: number): void {
    this.assertActive();
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("Paged scan item count must be a non-negative safe integer");
    }
    if (this.items + count > this.maxItems) {
      throw this.error("items");
    }
    this.items += count;
  }

  /** Converts an in-flight request failure to an abort when its signal fired. */
  public rethrowIfAborted(cause: unknown): void {
    if (this.signal?.aborted === true) {
      throw this.error("aborted", { cause });
    }
  }

  private assertActive(): void {
    if (this.signal?.aborted === true) {
      throw this.error("aborted", { cause: this.signal.reason });
    }
  }

  private error(
    reason: PagedScanBudgetReason,
    options?: ErrorOptions,
  ): PagedScanBudgetError {
    return new PagedScanBudgetError(
      `Paged scan stopped at ${String(this.items)} items and ${String(this.pages)} pages: ${reason}`,
      { reason, items: this.items, pages: this.pages, ...options },
    );
  }
}

/**
 * Fetches and collects every page while enforcing cursor progress.
 *
 * @remarks `pageSize` is passed to each request and is not a total result cap.
 * Empty and short pages complete the scan. Every full page must return a
 * non-empty cursor not previously observed by the scan. Legitimate advancing
 * scans continue without an item or page limit.
 *
 * @public
 */
export async function collectPagedScan<T>(
  fetchPage: (pageSize: number, after: string | undefined) => Promise<PagedScanPage<T>>,
  options: {
    pageSize: number;
    budget?: PagedScanBudget;
  },
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iteratePagedScan(fetchPage, options)) {
    results.push(item);
  }
  return results;
}

async function* iteratePagedScan<T>(
  fetchPage: (pageSize: number, after: string | undefined) => Promise<PagedScanPage<T>>,
  options: { pageSize: number; budget?: PagedScanBudget },
): AsyncGenerator<T> {
  assertPageSize(options.pageSize);

  const seenCursors = new Set<string>();
  let after: string | undefined;
  for (;;) {
    options.budget?.startPage();
    let page: PagedScanPage<T>;
    try {
      page = await fetchPage(options.pageSize, after);
    } catch (error) {
      options.budget?.rethrowIfAborted(error);
      throw error;
    }
    const items = "items" in page ? page.items : page.cells;
    options.budget?.addItems(items.length);
    yield* items;
    if (items.length < options.pageSize) {
      return;
    }
    if (
      page.lastCursor === undefined ||
      page.lastCursor === "" ||
      page.lastCursor === after ||
      seenCursors.has(page.lastCursor)
    ) {
      throw new PagedScanCursorError({
        previousCursor: after,
        lastCursor: page.lastCursor,
      });
    }
    seenCursors.add(page.lastCursor);
    after = page.lastCursor;
  }
}

/**
 * Collects CCC cell pages while preserving its cached and on-chain scan modes.
 *
 * @remarks Cached scans yield matching cached cells first, then omit unusable
 * or duplicate on-chain cells. On-chain scans use `findCellsPagedNoCache`, so
 * they neither read nor mutate CCC's cache. Both modes enforce cursor progress.
 *
 * @public
 */
export async function collectCellsPaged(
  client: ccc.Client,
  keyLike: Parameters<ccc.Client["findCells"]>[0],
  order: "asc" | "desc",
  options: { onChain: boolean; pageSize: number; budget?: PagedScanBudget },
): Promise<ccc.Cell[]> {
  const key = ccc.ClientIndexerSearchKey.from(keyLike);
  const cached: ccc.Cell[] = [];
  const cells = await collectPagedScan(
    async (requestPageSize, after) => {
      if (!options.onChain && after === undefined) {
        for await (const cell of client.cache.findCells(key)) {
          cached.push(cell);
        }
      }
      return options.onChain
        ? client.findCellsPagedNoCache(key, order, requestPageSize, after)
        : client.findCellsPaged(key, order, requestPageSize, after);
    },
    {
      pageSize: options.pageSize,
      ...(options.budget === undefined ? {} : { budget: options.budget }),
    },
  );
  if (options.onChain) {
    return cells;
  }

  const result = [...cached];
  for (const cell of cells) {
    if (
      !(await client.cache.isUnusable(cell.outPoint)) &&
      cached.every((cachedCell) => !cachedCell.outPoint.eq(cell.outPoint))
    ) {
      result.push(cell);
    }
  }
  return result;
}

/** Iterates signer-owned committed candidate pages without using CCC's cell cache. @public */
export async function* findSignerCellsPagedNoCache(
  signer: ccc.Signer,
  filter: Parameters<ccc.Signer["findCellsOnChain"]>[0],
  options: { pageSize: number; budget?: PagedScanBudget },
): AsyncGenerator<ccc.Cell, void> {
  const seen = new Set<string>();
  const locks = unique((await signer.getAddressObjs()).map(({ script }) => script));
  for (const lock of locks) {
    const key = ccc.ClientIndexerSearchKey.from({
      script: lock,
      scriptType: "lock",
      filter,
      scriptSearchMode: "exact",
      withData: true,
    });
    for await (const cell of iteratePagedScan(
      async (pageSize, after): ReturnType<ccc.Client["findCellsPagedNoCache"]> =>
        signer.client.findCellsPagedNoCache(key, "asc", pageSize, after),
      options,
    )) {
      const outPoint = cell.outPoint.toHex();
      if (!cell.cellOutput.lock.eq(lock) || seen.has(outPoint)) {
        continue;
      }
      seen.add(outPoint);
      yield cell;
    }
  }
}

function assertPageSize(pageSize: number): void {
  assertPositiveSafeInteger(pageSize, "pageSize");
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
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
