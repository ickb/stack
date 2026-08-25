/**
 * @packageDocumentation
 *
 * Entry-point script that samples block headers from a CKB mainnet public client,
 * or an injected compatible client, and prints a CSV report (BlockNumber, Date,
 * CkbPerIckb, Note).
 *
 * Summary of behavior:
 * - Uses an injected client when provided, otherwise constructs `ccc.ClientPublicMainnet`.
 * - Queries the genesis and tip headers.
 * - Logs genesis separately, then builds a set of Date samples between genesis
 *   and tip, adding "iCKB Launch" only when it falls in range.
 * - For each historical sample date, performs a bounded binary search over block
 *   numbers and labels the result approximate because block timestamps may decrease.
 * - Logs the fetched tip header last; like genesis it is exact, not searched.
 * - Logs CSV lines with block number, ISO timestamp, CKB per 1 iCKB, and an optional note.
 *
 * Remarks:
 * - The sampling functions accept timestamps as bigint millisecond values.
 * - This file runs in Node.js (uses top-level await) and exits on completion or error.
 * - Failures in fetching blocks will throw.
 *
 * Example output (CSV):
 * BlockNumber, Date, CkbPerIckb, Note
 * 0, 2019-11-15T21:09:50.812Z, 1.00082, Genesis
 *
 * @public
 */

import { ccc } from "@ckb-ccc/core";
import { convert, ickbExchangeRatio } from "@ickb/core";
import { asyncBinarySearch } from "@ickb/utils";
import { pathToFileURL } from "node:url";

interface MainOptions {
  /** Optional client override for tests or alternate mainnet RPC providers. */
  client?: ccc.Client;

  /** Optional default-client factory for tests. */
  createClient?: () => ccc.Client;

  /** Optional line logger; defaults to stdout. */
  log?: (line: string) => void;

  /** Number of evenly spaced timestamp positions to consider per covered UTC year. */
  samplesPerYear?: number;
}

export async function runSamplerEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  run: () => Promise<void> = main,
): Promise<void> {
  if (argv[1] === undefined || moduleUrl !== pathToFileURL(argv[1]).href) {
    return;
  }

  await run();
}

/**
 * Main program that orchestrates sampling and logging.
 *
 * - Uses an injected client when provided, otherwise constructs a public mainnet client.
 * - Fetches genesis and tip headers (throws if genesis is missing).
 * - Computes a power-of-two search bound from the bit-length of tip.number.
 * - Generates date samples using `samplesPerYear` and adds "iCKB Launch" when in range.
 * - For each historical date sample, uses `asyncBinarySearch` to select an
 *   approximate block and marks that limitation in the CSV note.
 * - Logs the sampled tip header itself as the exact final row.
 *
 * @remarks The tip is sampled once at startup and used as the upper bound for
 * every search in this run.
 *
 * Notes on error handling:
 * - Missing probed headers move binary search left; a missing selected result
 *   header causes this function to throw.
 *
 * @returns Promise<void> that resolves when sampling and logging complete.
 *
 * @public
 */
export async function main(options: MainOptions = {}): Promise<void> {
  // Create a public mainnet client (network I/O happens on method calls).
  const createClient = options.createClient ?? createSamplerClient;
  const client = options.client ?? createClient();
  const log =
    options.log ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const headers = new Map<number, ccc.ClientBlockHeader | undefined>();
  const getHeader = async (
    blockNumber: number,
  ): Promise<ccc.ClientBlockHeader | undefined> => {
    if (!headers.has(blockNumber)) {
      headers.set(blockNumber, await client.getHeaderByNumber(blockNumber));
    }
    return headers.get(blockNumber);
  };

  // Fetch genesis header (block 0). If absent, abort early.
  const genesis = await getHeader(0);
  if (genesis === undefined) {
    throw new Error("Genesis block not found");
  }

  // Fetch tip header to bound our searches.
  const tip = await client.getTipHeader();

  const searchBound = 1n << BigInt(tip.number.toString(2).length);
  if (searchBound > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Tip block number exceeds sampler search range");
  }
  const n = Number(searchBound);

  const dates = sampleTargets(genesis.timestamp, tip.timestamp, options.samplesPerYear);

  // Emit CSV header and the genesis row.
  log(["BlockNumber", "Date", "CkbPerIckb", "Note"].join(", "));
  logRow(genesis, "Genesis", log);

  // Consensus permits timestamp decreases, so binary-search rows are approximate.
  for (const [date, note] of dates) {
    // asyncBinarySearch expects a predicate that returns true when the index i
    // is at or past the desired condition. We provide a predicate that fetches
    // the header and compares timestamps.
    const blockNumber = await asyncBinarySearch(
      n,
      async (i: number): Promise<boolean> => {
        const header = await getHeader(i);
        if (header === undefined) {
          // If there's no header at i, signal "true" so the search moves left.
          return true;
        }
        // header.timestamp is numeric-like; convert to Number and compare to Date.
        return date <= new Date(Number(header.timestamp));
      },
    );

    // Fetch header for the found block number and log it.
    const header = await getHeader(blockNumber);
    if (header === undefined) {
      throw new Error("Header not found");
    }

    logRow(header, note, log);
  }

  // The tip header is already exact, so it is logged directly like genesis.
  logRow(tip, "Tip", log);
}

export function createSamplerClient(): ccc.Client {
  return new ccc.ClientPublicMainnet({
    url: "https://mainnet.ckb.dev/",
    fallbacks: [],
  });
}

function sampleTargets(startMs: bigint, endMs: bigint, n = 4): Array<[Date, string]> {
  const dates = samples(startMs, endMs, n).map((date): [Date, string] => [
    date,
    "Approximate timestamp sample",
  ]);
  const launch = new Date("2024-09-12T15:13:19.574Z");
  const launchMs = BigInt(launch.getTime());
  if (launchMs >= startMs && launchMs <= endMs) {
    dates.push([launch, "Approximate iCKB Launch"]);
  }
  dates.sort((a, b) => a[0].getTime() - b[0].getTime());
  return dates;
}

/**
 * Log a CSV row for a header.
 *
 * Behavior:
 * - Converts 1 iCKB via `convert(false, ccc.One, ickbExchangeRatio(header))`,
 *   formats it with `ccc.fixedPointToString`, and writes a CSV line.
 * - This helper is intentionally lightweight and will throw only on programmer errors
 *   (e.g. unexpected undefined header when called).
 *
 * @param header - Block header to log.
 * @param note - Optional short note to include in the CSV row (e.g. "Genesis"...).
 *
 * @internal
 */
function logRow(
  header: ccc.ClientBlockHeader,
  note: string,
  log: (line: string) => void,
): void {
  // Compute ISO timestamp from header timestamp (milliseconds).
  const date = new Date(Number(header.timestamp));
  // Include the recoverable occupied capacity of a standard deposit.
  const val = convert(false, ccc.One, ickbExchangeRatio(header));
  // Emit CSV row: blockNumber, ISO date, formatted value, note.
  log(
    [String(header.number), date.toISOString(), ccc.fixedPointToString(val), note].join(
      ", ",
    ),
  );
}

/**
 * Generate a set of sample Dates between two millisecond-based bigints.
 *
 * The function:
 * - Splits the overall [startMs, endMs] span by UTC calendar years.
 * - Considers `n` evenly-spaced positions within each year span [Y0, Y1).
 * - Returns only positions inside the inclusive overall range as Date objects.
 *
 * @param startMs - Inclusive start of the sampling range as a bigint (ms since epoch).
 * @param endMs - Inclusive end of the sampling range as a bigint (ms since epoch).
 * @param n - Number of evenly-spaced positions to consider per year span. Must be a positive safe integer.
 *
 * @returns An array of Date objects. Samples are generated year-by-year; calling
 *          code may sort again for global ordering (the caller does so).
 *
 * @throws Error if `endMs < startMs` or if `n` is not a positive safe integer.
 *
 * @public
 */
export function samples(startMs: bigint, endMs: bigint, n: number): Date[] {
  if (endMs < startMs) {
    throw new Error("endMs must be bigger than startMs");
  }
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("n must be a positive safe integer");
  }

  // Convert bigints (ms) to Dates for year extraction.
  const start = new Date(Number(startMs));
  const end = new Date(Number(endMs));
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const out: Date[] = [];

  // For each UTC year in the covered range, generate n samples inside that year.
  for (let year = startYear; year <= endYear; year++) {
    // Y0 is start of `year` in ms (UTC), Y1 is start of next year.
    const Y0 = Date.UTC(year, 0, 1);
    const Y1 = Date.UTC(year + 1, 0, 1);
    const span = Y1 - Y0;

    for (let i = 0; i < n; i++) {
      // Evenly space n samples in [Y0, Y1). Round to nearest millisecond.
      const t = Y0 + Math.round((span * i) / n);
      const sample = new Date(t);
      // Only include samples that fall within the inclusive overall range.
      if (sample >= start && sample <= end) {
        out.push(sample);
      }
    }
  }

  return out;
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runSamplerEntrypoint();
