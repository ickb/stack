import { ccc } from "@ckb-ccc/ccc";
import { CKB } from "./utils.ts";

const twoDecimalFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** Two decimals, rounded half up: the estimate's precision on screen. */
export function twoDecimals(shannons: bigint): string {
  return twoDecimalFormat.format(exactDecimal(shannons));
}

/**
 * CCC's exact decimal string, typed for Intl, which formats a numeric string as written
 * rather than through a double that cannot hold eight decimals of a large amount.
 */
function exactDecimal(shannons: bigint): `${number}` {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- fixedPointToString returns a plain decimal numeral.
  return ccc.fixedPointToString(shannons) as `${number}`;
}

// A balance rounds toward zero, so a figure the user types back never exceeds what is held.
const balanceFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  roundingMode: "trunc",
});

const compactBalanceFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  roundingMode: "trunc",
});

/** A balance figure: two decimals, thousands grouped, compact ("123.45K") from `compactFrom` whole units. */
export function figureText(shannons: bigint, compactFrom?: bigint): string {
  const decimal = exactDecimal(shannons);
  return compactFrom !== undefined && shannons / CKB >= compactFrom
    ? compactBalanceFormat.format(decimal)
    : balanceFormat.format(decimal);
}

/**
 * Thousands separators for a plain decimal string, as typed or as quoted; anything else,
 * an intermediate like "." or an invalid entry like "1e2", comes back untouched.
 */
export function groupDigits(text: string): string {
  const [whole = "", fraction, ...more] = text.split(".");
  if (
    more.length > 0 ||
    !isDigits(whole) ||
    (fraction !== undefined && !isDigits(fraction))
  ) {
    return text;
  }
  let grouped = "";
  for (let index = 0; index < whole.length; index += 1) {
    if (index > 0 && (whole.length - index) % 3 === 0) {
      grouped += ",";
    }
    grouped += whole[index] ?? "";
  }
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function isDigits(text: string): boolean {
  return /^\d*$/u.test(text);
}

/** The chart caption's amount, in the ticks' own compact style so the two never disagree. */
export function chartAmountText(shannons: bigint): string {
  return compactText(shannons, 1);
}

// Three significant digits with a K, M or B suffix and no trailing zeros; below 1 the
// two-decimal cap wins, so 0.8283 reads 0.83 rather than 0.828.
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
  maximumFractionDigits: 2,
  roundingPriority: "lessPrecision",
});

/** The amount scaled by `scale`, as the chart's axis labels read. */
export function compactText(shannons: bigint, scale: number): string {
  return compactFormat.format(Number(ccc.fixedPointToString(shannons)) * scale);
}
