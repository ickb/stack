/**
 * @packageDocumentation
 *
 * Samples block headers from a CKB client into CSV rows (BlockNumber, Date,
 * CkbPerIckb, Note): the exact genesis and tip headers, plus evenly spaced dates
 * between them located by a bounded binary search over block numbers. Those rows
 * are approximate because consensus permits block timestamps to decrease.
 *
 * Example output (CSV):
 * BlockNumber, Date, CkbPerIckb, Note
 * 0, 2019-11-15T21:09:50.812Z, 1.00082, Genesis
 */

import { ccc } from "@ckb-ccc/core";
import { convert, ickbExchangeRatio } from "../../../src/udt.ts";
import { asyncBinarySearch } from "../../../src/utils/index.ts";

/**
 * Yields the CSV header, the genesis row, one approximate row per sample date
 * (`samplesPerYear` evenly spaced positions per covered UTC year plus the iCKB
 * launch when in range), and the exact tip row.
 *
 * @remarks The tip is read once and bounds every search. A missing probed header
 * moves the search left; a missing genesis or selected header throws.
 */
export async function* sampleRows(
  client: ccc.Client,
  samplesPerYear?: number,
): AsyncGenerator<string> {
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

  const dates = sampleTargets(genesis.timestamp, tip.timestamp, samplesPerYear);

  yield ["BlockNumber", "Date", "CkbPerIckb", "Note"].join(", ");
  yield row(genesis, "Genesis");

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

    yield row(header, note);
  }

  // The tip header is already exact, so it is emitted directly like genesis.
  yield row(tip, "Tip");
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

/** CSV row: block number, ISO date, CKB per 1 iCKB at that header, note. */
function row(header: ccc.ClientBlockHeader, note: string): string {
  const date = new Date(Number(header.timestamp));
  const val = convert(false, ccc.One, ickbExchangeRatio(header));
  return [
    String(header.number),
    date.toISOString(),
    ccc.fixedPointToString(val),
    note,
  ].join(", ");
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
