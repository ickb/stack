export function timeUntilMaturity(
  estimatedMaturity: bigint,
  tipTimestamp: bigint,
): string {
  const remaining = estimatedMaturity - tipTimestamp;
  if (remaining <= 0n) {
    return "⌛️ Ready";
  }

  const minute = 60_000n;

  if (remaining <= 90n * minute) {
    return `⏳ ${String(Number((remaining + minute - 1n) / minute))} minutes`;
  }

  const hour = 60n * minute;
  const day = 24n * hour;

  if (remaining <= day) {
    return `⏳ ${String(Number((remaining + hour - 1n) / hour))} hours`;
  }

  return `⏳ ${String(Number((remaining + day - 1n) / day))} days`;
}
