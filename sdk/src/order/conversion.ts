import { ccc } from "@ckb-ccc/core";
import {
  ceilDiv,
  minBigInt,
  type ExchangeRatio,
  type ValueComponents,
} from "../utils/utils.ts";
import { Info } from "./info.ts";
import { Ratio } from "./ratio.ts";

const maxUint64 = (1n << 64n) - 1n;

/**
 * Error thrown when an exact quote cannot be represented by the order ratio format.
 */
export class OrderConversionRepresentabilityError extends Error {
  /** Creates a representability error with the default public conversion message. */
  constructor(
    message = "Order conversion quote cannot be represented as Uint64 ratio",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OrderConversionRepresentabilityError";
  }
}

/**
 * Quotes a new order: the output-side amount, the CKB fee, and the order info.
 *
 * @remarks
 * The returned `Info` preserves the quoted amount after fee adjustment so the
 * minted order records the executable limit price.
 */
export function quoteConversion(
  isCkb2Udt: boolean,
  midpoint: ExchangeRatio,
  amounts: ValueComponents,
  options?: {
    fee?: ccc.Num;
    feeBase?: ccc.Num;
  },
): { convertedAmount: ccc.FixedPoint; ckbFee: ccc.FixedPoint; info: Info } {
  const fee = options?.fee ?? 0n;
  // Generic denominator for callers that pass a fee without a scale; Stack's
  // own default pair is owned publicly by the SDK, not by this entity.
  const feeBase = options?.feeBase ?? 100000n;
  const base = Ratio.from(midpoint);
  const amount = isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
  const { aScale, bScale } = feeAdjustedScales(base, isCkb2Udt, fee, feeBase);
  const convertedAmount = ceilDiv(amount * aScale, bScale);
  let ckbFee = 0n;

  if (amount > 0n && fee !== 0n) {
    ckbFee = isCkb2Udt
      ? amount - base.convert(false, convertedAmount, false)
      : base.convert(false, amount, false) - convertedAmount;
  }

  // Every order this SDK creates carries the default minimum match, the one the bot's
  // remainder rule is sized to (decision 52(aj)(2)).
  const info = Info.create(
    isCkb2Udt,
    quotePreservingRatio(amount, convertedAmount, isCkb2Udt),
  );
  return { convertedAmount, ckbFee, info };
}

/** The direction's scales with the fee taken out of the output side, reduced. */
function feeAdjustedScales(
  ratio: Ratio,
  isCkb2Udt: boolean,
  fee: ccc.Num,
  feeBase: ccc.Num,
): { aScale: ccc.Num; bScale: ccc.Num } {
  if (fee < 0n) {
    throw new Error("Fee cannot be negative");
  }
  if (feeBase <= 0n) {
    throw new Error("Fee base must be positive");
  }
  if (fee >= feeBase) {
    throw new Error("Fee too big relative to feeBase");
  }
  if (!ratio.isPopulated()) {
    throw new Error("Invalid ExchangeRatio");
  }

  let { ckbScale: aScale, udtScale: bScale } = ratio;
  if (!isCkb2Udt) {
    [aScale, bScale] = [bScale, aScale];
  }
  aScale *= feeBase - fee;
  bScale *= feeBase;
  const divisor = ccc.gcd(aScale, bScale);
  return { aScale: aScale / divisor, bScale: bScale / divisor };
}

/**
 * The ratio that reproduces the quote exactly: the greatest Uint64 fraction at most
 * `quotedOutput / inputAmount`, which must still round the input up to the quoted output.
 */
export function quotePreservingRatio(
  inputAmount: ccc.FixedPoint,
  quotedOutput: ccc.FixedPoint,
  isCkb2Udt: boolean,
): Ratio {
  if (inputAmount < 0n || quotedOutput < 0n) {
    throw new Error("Order conversion amounts cannot be negative");
  }
  if (inputAmount === 0n || quotedOutput === 0n) {
    throw new OrderConversionRepresentabilityError(
      "Order conversion quote must have positive input and output",
    );
  }

  const { numerator, denominator } = greatestBoundedFractionAtMost(
    quotedOutput,
    inputAmount,
    maxUint64,
  );
  if (numerator <= 0n || (quotedOutput - 1n) * denominator >= inputAmount * numerator) {
    throw new OrderConversionRepresentabilityError();
  }

  return Ratio.from({
    ckbScale: isCkb2Udt ? numerator : denominator,
    udtScale: isCkb2Udt ? denominator : numerator,
  });
}

/**
 * The greatest fraction at most `numerator / denominator` whose terms are at most
 * `maxTerm`, reduced. It walks the continued fraction's convergents while they fit; the
 * first that does not is replaced by the largest semiconvergent the bound allows, which
 * is closer to the target than the last fitting convergent on the same side of it. Every
 * other convergent lands above the target and is skipped.
 */
export function greatestBoundedFractionAtMost(
  numerator: bigint,
  denominator: bigint,
  maxTerm: bigint,
): { numerator: bigint; denominator: bigint } {
  let best = { numerator: 0n, denominator: 1n };
  let [previousP, previousQ, p, q] = [0n, 1n, 1n, 0n];
  let [n, d] = [numerator, denominator];
  while (d !== 0n) {
    const quotient = n / d;
    let term = quotient;
    if (p !== 0n) {
      term = minBigInt(term, (maxTerm - previousP) / p);
    }
    if (q !== 0n) {
      term = minBigInt(term, (maxTerm - previousQ) / q);
    }
    const candidate = {
      numerator: term * p + previousP,
      denominator: term * q + previousQ,
    };
    if (
      candidate.denominator > 0n &&
      candidate.numerator * denominator <= candidate.denominator * numerator &&
      candidate.numerator * best.denominator > best.numerator * candidate.denominator
    ) {
      best = candidate;
    }
    if (term < quotient) {
      break;
    }
    [previousP, previousQ, p, q] = [p, q, candidate.numerator, candidate.denominator];
    [n, d] = [d, n % d];
  }
  return best;
}
