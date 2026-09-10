const CKB = 100000000n;

/**
 * Formats shannon as a trimmed decimal CKB amount.
 */
export function formatCkb(balance: bigint): string {
  const sign = balance < 0n ? "-" : "";
  const absolute = balance < 0n ? -balance : balance;
  const whole = absolute / CKB;
  const fraction = absolute % CKB;

  if (fraction === 0n) {
    return sign + whole.toString();
  }

  return `${sign}${whole.toString()}.${trimTrailingZeros(fraction.toString().padStart(8, "0"))}`;
}

function trimTrailingZeros(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "0") {
    end -= 1;
  }
  return value.slice(0, end);
}
