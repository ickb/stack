/** Completes the "Ready:" label: "now" or "in 3 days". */
export function timeUntilMaturity(
  estimatedMaturity: bigint,
  tipTimestamp: bigint,
): string {
  const remaining = estimatedMaturity - tipTimestamp;
  if (remaining <= 0n) {
    return "now";
  }

  const minute = 60_000n;

  if (remaining <= 90n * minute) {
    return `in ${String(Number((remaining + minute - 1n) / minute))} minutes`;
  }

  const hour = 60n * minute;
  const day = 24n * hour;

  if (remaining <= day) {
    return `in ${String(Number((remaining + hour - 1n) / hour))} hours`;
  }

  return `in ${String(Number((remaining + day - 1n) / day))} days`;
}
