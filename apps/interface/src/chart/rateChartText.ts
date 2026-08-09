import { CKB, clampShannons } from "../shared/utils.ts";

export function valueGridMarks(
  minY: number,
  maxY: number,
  unit: string,
  amount: bigint,
): Array<{ readonly value: number; readonly label: string }> {
  const marks = [minY, (minY + maxY) / 2, maxY]
    .filter(
      (value, index, values) =>
        value >= minY &&
        value <= maxY &&
        values.findIndex((other) => Math.abs(other - value) < 0.005) === index,
    )
    .map((value) => ({
      value,
      label: `${scaledAmountText(amount, value)} ${unit}`,
    }));

  return marks.filter(
    ({ label }, index) => marks.findIndex((mark) => mark.label === label) === index,
  );
}

export function chartAmountText(amount: bigint): string {
  return trimTrailingDecimalZeros(graphAmountText(amount, 1));
}

function scaledAmountText(amount: bigint, scale: number): string {
  return trimTrailingDecimalZeros(graphAmountText(amount, scale));
}

export function graphAmountText(amount: bigint, scale: number): string {
  const value = fixedPointNumber(amount) * scale;
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

function fixedPointNumber(amount: bigint): number {
  const clamped = clampShannons(amount);
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
