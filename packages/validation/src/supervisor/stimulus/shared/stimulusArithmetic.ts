import {
  CKB,
  CKB_SPENDING_STIMULUS_BUFFER,
  MATURITY_FEE_MULTIPLIER,
} from "./liveBotStimulusConstants.ts";

interface OrderFeePolicy {
  readonly fee: bigint;
  readonly feeBase: bigint;
}

export function fixed8DecimalToUnits(value: string | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  const [whole, fraction, extra] = value.split(".");
  if (
    extra !== undefined ||
    whole === undefined ||
    !isCanonicalUnsignedInteger(whole) ||
    (fraction !== undefined && !/^\d{1,8}$/u.test(fraction))
  ) {
    return undefined;
  }
  return BigInt(whole) * CKB + BigInt((fraction ?? "").padEnd(8, "0"));
}

function isCanonicalUnsignedInteger(value: string): boolean {
  return /^(?:0|[1-9]\d*)$/u.test(value);
}

export function parseCanonicalUnsignedInteger(value: unknown): bigint | undefined {
  return typeof value === "string" && isCanonicalUnsignedInteger(value)
    ? BigInt(value)
    : undefined;
}

export function allCkbLimitOrderMinimum(
  feeRate: bigint,
  feePolicy: OrderFeePolicy,
): bigint | undefined {
  if (feeRate === 0n) {
    return CKB_SPENDING_STIMULUS_BUFFER * CKB + 1n;
  }
  if (
    feePolicy.fee <= 0n ||
    feePolicy.feeBase <= 0n ||
    feePolicy.fee >= feePolicy.feeBase
  ) {
    return undefined;
  }
  const minimumOrderAmount = divCeil(
    MATURITY_FEE_MULTIPLIER * feeRate * feePolicy.feeBase,
    feePolicy.fee,
  );
  return CKB_SPENDING_STIMULUS_BUFFER * CKB + minimumOrderAmount;
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
