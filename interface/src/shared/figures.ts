import { CKB, clampShannons, toText } from "./utils.ts";

/** The figure at full precision with thousands grouped, for a wide screen. */
export function figureText(shannons: bigint): string {
  return groupDigits(toText(shannons));
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

/** Three significant digits with a K, M or G suffix, trailing zeros trimmed. */
export function compactText(shannons: bigint, scale: number): string {
  return trimTrailingDecimalZeros(graphAmountText(shannons, scale));
}

/** Three significant digits with a K, M or G suffix, as the chart's axis labels read. */
export function graphAmountText(shannons: bigint, scale: number): string {
  const value = fixedPointNumber(shannons) * scale;
  if (!Number.isFinite(value)) {
    return "184G";
  }
  if (value >= 999500000) {
    return `${trimSignificant(value / 1000000000)}G`;
  }
  if (value >= 999500) {
    return `${trimSignificant(value / 1000000)}M`;
  }
  if (value >= 999.5) {
    return `${trimSignificant(value / 1000)}K`;
  }
  return trimSignificant(value);
}

function fixedPointNumber(shannons: bigint): number {
  const clamped = clampShannons(shannons);
  return Number(clamped / CKB) + Number(clamped % CKB) / Number(CKB);
}

function trimSignificant(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 100) {
    return value.toFixed(0);
  }
  if (absValue >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}

function trimTrailingDecimalZeros(value: string): string {
  const lastCharacter = value.slice(-1);
  const suffix = ["K", "M", "G"].includes(lastCharacter) ? lastCharacter : "";
  let trimmed = suffix !== "" ? value.slice(0, -1) : value;
  while (trimmed.includes(".") && trimmed.endsWith("0")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (trimmed.endsWith(".")) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}${suffix}`;
}
