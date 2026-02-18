/**
 * @packageDocumentation
 *
 * Entry-point script that samples block headers from a CKB mainnet public client
 * and prints a CSV report (BlockNumber, Date, Value, Note).
 *
 * Summary of behavior:
 * - Constructs a `ccc.ClientPublicMainnet` client and queries the genesis and tip headers.
 * - Builds a set of Date samples between genesis and tip (including a small set of
 *   named dates such as "Genesis", "iCKB Launch", and the "Tip").
 * - For each sample date, performs a binary search over block numbers to find
 *   the first block whose timestamp is greater than or equal to the sample date.
 * - Logs CSV lines with block number, ISO timestamp, converted value, and an optional note.
 *
 * Remarks:
 * - The sampling functions accept timestamps as bigint millisecond values.
 * - This file runs in Node.js (uses top-level await) and exits on completion or error.
 * - Failures in fetching blocks will throw.
 *
 * Example output (CSV):
 * BlockNumber, Date, Value, Note
 * 0, 2019-11-15T21:09:50.812Z, 1.00082, Genesis
 *
 * @public
 */

import { ccc } from "@ckb-ccc/core";
import { convert } from "@ickb/core";
import { asyncBinarySearch } from "@ickb/utils";

/**
 * Main program that orchestrates sampling and logging.
 *
 * - Constructs a public mainnet client.
 * - Fetches genesis and tip headers (throws if missing).
 * - Computes an upper bound `n` for the block-number binary search using the
 *   bit-length of tip.number (a simple power-of-two bound).
 * - Generates date samples (per-year, `n` samples per year) and inserts a
 *   named "iCKB Launch" sample.
 * - For each date sample, finds the earliest block whose timestamp >= sample
 *   date via `asyncBinarySearch` and logs a CSV row for that header.
 *
 * Notes on error handling:
 * - Missing blocks will cause this function to throw.
 *
 * @returns Promise<void> that resolves when sampling and logging complete.
 *
 * @public
 */
export async function main(): Promise<void> {
  // Create a public mainnet client (network I/O happens on method calls).
  const client = new ccc.ClientPublicMainnet();

  // Fetch genesis header (block 0). If absent, abort early.
  const genesis = await client.getHeaderByNumber(0);
  if (!genesis) {
    throw new Error("Genesis block not found");
  }

  // Fetch tip header to bound our searches.
  const tip = await client.getTipHeader();

  // Compute an upper bound `n` for the binary search using the bit-length
  // of the tip number. This yields a power-of-two >= tip.number.
  const n = 1 << tip.number.toString(2).length;

  // Generate date samples between genesis and tip (timestamps are bigints in ms).
  // The samples(...) helper returns Date instances; attach optional notes here.
  const dates = samples(genesis.timestamp, tip.timestamp, 4).map(
    (d) => [d, ""] as [Date, string],
  );
  // Insert a named event sample (kept as an example of adding special dates).
  dates.push([new Date("2024-09-12T15:13:19.574Z"), "iCKB Launch"]);
  // Ensure chronological order across all samples (safety).
  dates.sort((a, b) => a[0].getTime() - b[0].getTime());

  // Emit CSV header and the genesis row.
  console.log(["BlockNumber", "Date", "Value", "Note"].join(", "));
  logRow(genesis, "Genesis");

  // For each sample date, find the earliest block whose timestamp is >= date.
  for (const [date, note] of dates) {
    // asyncBinarySearch expects a predicate that returns true when the index i
    // is at or past the desired condition. We provide a predicate that fetches
    // the header and compares timestamps.
    const blockNumber = await asyncBinarySearch(
      n,
      async (i: number): Promise<boolean> => {
        const header = await client.getHeaderByNumber(i);
        if (!header) {
          // If there's no header at i, signal "true" so the search moves left.
          return true;
        }
        // header.timestamp is numeric-like; convert to Number and compare to Date.
        return date <= new Date(Number(header.timestamp));
      },
    );

    // Fetch header for the found block number and log it.
    const header = await client.getHeaderByNumber(blockNumber);
    if (!header) {
      throw new Error("Header not found");
    }

    logRow(header, note);
  }
}

/**
 * Log a CSV row for a header.
 *
 * Behavior:
 * - Converts the header value via `convert(false, ccc.One, header)`,
 *   formats it with `ccc.fixedPointToString`, and writes a CSV line.
 * - This helper is intentionally lightweight and will throw only on programmer errors
 *   (e.g. unexpected undefined header when called).
 *
 * @param header - Block header to log.
 * @param note - Optional short note to include in the CSV row (e.g. "Genesis"...).
 *
 * @internal
 */
function logRow(header: ccc.ClientBlockHeader, note: string): void {
  // Compute ISO timestamp from header timestamp (milliseconds).
  const date = new Date(Number(header.timestamp));
  // Convert the header's monetary value to a fixed-point representation.
  const val = convert(false, ccc.One, header);
  // Emit CSV row: blockNumber, ISO date, formatted value, note.
  console.log(
    [
      String(header.number),
      date.toISOString(),
      ccc.fixedPointToString(val),
      note,
    ].join(", "),
  );
}

/**
 * Generate a set of sample Dates between two millisecond-based bigints.
 *
 * The function:
 * - Splits the overall [startMs, endMs] span by UTC calendar years.
 * - Emits `n` evenly-spaced samples within each year span [Y0, Y1).
 * - Uses integer-rounded millisecond timestamps and returns Date objects.
 *
 * @param startMs - Inclusive start of the sampling range as a bigint (ms since epoch).
 * @param endMs - Inclusive end of the sampling range as a bigint (ms since epoch).
 * @param n - Number of evenly-spaced samples to generate per year span. Must be >= 1.
 *
 * @returns An array of Date objects. Samples are generated year-by-year; calling
 *          code may sort again for global ordering (the caller does so).
 *
 * @throws Error if endMs < startMs or if n < 1.
 *
 * @public
 */
export function samples(startMs: bigint, endMs: bigint, n: number): Date[] {
  if (endMs < startMs) throw new Error("endMs must be bigger than startMs");
  if (n < 1) throw new Error("n must be a positive number");

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

await main();

process.exit(0);
