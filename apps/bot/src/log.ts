import { CKB } from "./policy.js";

export function formatCkb(balance: bigint): string {
  const sign = balance < 0n ? "-" : "";
  const absolute = balance < 0n ? -balance : balance;
  const whole = absolute / CKB;
  const fraction = absolute % CKB;

  if (fraction === 0n) {
    return sign + whole.toString();
  }

  return `${sign}${whole.toString()}.${fraction.toString().padStart(8, "0").replace(/0+$/u, "")}`;
}

export function jsonLogReplacer(_: unknown, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
