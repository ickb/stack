import { ccc } from "@ckb-ccc/ccc";
import { CKB } from "./utils.ts";

/** The figure at full precision with thousands grouped, for a wide screen. */
export function figureText(shannons: bigint): string {
  return groupDigits(ccc.fixedPointToString(shannons));
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

/**
 * The figure a narrow place holds: whole units, "+" for any fraction, and the compact form
 * from `compactFrom` whole units. A phone balance column is about 100px, where "9,999,999+"
 * is 90px and one digit more fills it.
 */
export function phoneFigureText(shannons: bigint, compactFrom = 10_000_000n): string {
  const whole = shannons / CKB;
  if (whole >= compactFrom) {
    return compactText(shannons, 1);
  }
  return `${groupDigits(String(whole))}${shannons % CKB === 0n ? "" : "+"}`;
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
