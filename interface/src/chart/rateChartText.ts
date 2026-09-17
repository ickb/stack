import { compactText } from "../shared/figures.ts";

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
      label: `${compactText(amount, value)} ${unit}`,
    }));

  return marks.filter(
    ({ label }, index) => marks.findIndex((mark) => mark.label === label) === index,
  );
}
