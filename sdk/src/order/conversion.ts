import { ccc } from "@ckb-ccc/core";
import type { ConversionDirection } from "../conversion/types.ts";
import { ckbFromUdt } from "../udt.ts";
import { ceilDiv, type ExchangeRatio } from "../utils/utils.ts";
import { Info } from "./info.ts";
import { Ratio } from "./ratio.ts";

const maxUint64 = (1n << 64n) - 1n;

/**
 * Default order fee: 0.01%. At roughly 2% annual DAO yield this buys about two days of
 * price headroom for a buy, versus hours at 0.001%; actual fillability also depends on
 * mining fees. It leaves time to notice a stalled bot without charging the much larger 0.1%.
 */
export const DEFAULT_ORDER_FEE = 10n;

/** Default order-fee denominator used by Stack conversion quotes and plans. */
export const DEFAULT_ORDER_FEE_BASE = 100000n;

/**
 * Whether `direction` converts CKB to iCKB. Any value but the two throws a `TypeError`, so a
 * plain-JS caller's typo is refused rather than read as iCKB to CKB.
 */
export function isCkbToIckb(direction: ConversionDirection): boolean {
  switch (direction) {
    case "ckb-to-ickb":
      return true;
    case "ickb-to-ckb":
      return false;
    default:
      throw new TypeError(`Unknown conversion direction: ${String(direction)}`);
  }
}

/** A quote, or `unrepresentable` when no Uint64 order ratio reproduces it. */
export type QuoteConversionResult =
  | { ok: true; convertedAmount: ccc.FixedPoint; ckbFee: ccc.FixedPoint }
  | { ok: false; reason: "unrepresentable" };

/**
 * Quotes converting `amount` of the input side (CKB or iCKB, in shannons) at the SDK's
 * default order fee: the output-side amount and the CKB fee.
 */
export function quoteConversion(
  direction: ConversionDirection,
  midpoint: ExchangeRatio,
  amount: ccc.FixedPoint,
): QuoteConversionResult {
  const quote = quoteOrder(direction, midpoint, amount);
  if (!quote.ok) {
    return quote;
  }
  const { convertedAmount, ckbFee } = quote;
  return { ok: true, convertedAmount, ckbFee };
}

/**
 * Quotes a new order for `amount` of the input side (CKB or iCKB, in shannons): the
 * output-side amount, the CKB fee, and the order info. Fee and fee base default to the SDK's.
 *
 * @remarks
 * The returned `Info` carries the ratio that reproduces the quote exactly: the greatest
 * Uint64 fraction at most `convertedAmount / amount`, which must still round the input up
 * to the quoted output, so the minted order records the executable limit price. A zero
 * amount, or a quote no such fraction reproduces, is `unrepresentable`; a negative amount
 * throws.
 */
export function quoteOrder(
  direction: ConversionDirection,
  midpoint: ExchangeRatio,
  amount: ccc.FixedPoint,
  {
    fee = DEFAULT_ORDER_FEE,
    feeBase = DEFAULT_ORDER_FEE_BASE,
  }: { fee?: ccc.Num; feeBase?: ccc.Num } = {},
):
  | { ok: true; convertedAmount: ccc.FixedPoint; ckbFee: ccc.FixedPoint; info: Info }
  | { ok: false; reason: "unrepresentable" } {
  const isCkb2Udt = isCkbToIckb(direction);
  const base = Ratio.from(midpoint);
  const { aScale, bScale } = feeAdjustedScales(base, isCkb2Udt, fee, feeBase);
  const convertedAmount = ceilDiv(amount * aScale, bScale);
  let ckbFee = 0n;

  if (amount > 0n && fee !== 0n) {
    ckbFee = isCkb2Udt
      ? amount - ckbFromUdt(convertedAmount, base)
      : ckbFromUdt(amount, base) - convertedAmount;
  }

  // The quote is the input times a positive ratio, rounded up, so its sign is the input's.
  if (amount < 0n) {
    throw new Error("Order conversion amounts cannot be negative");
  }
  if (amount === 0n) {
    return { ok: false, reason: "unrepresentable" };
  }
  const { numerator, denominator } = greatestBoundedFractionAtMost(
    convertedAmount,
    amount,
    maxUint64,
  );
  // A zero numerator also lands here: the quote of a positive input is at least one.
  if ((convertedAmount - 1n) * denominator >= amount * numerator) {
    return { ok: false, reason: "unrepresentable" };
  }

  // Every order this SDK creates carries the default minimum match, the one the bot's
  // remainder rule is sized to.
  const info = Info.create(
    isCkb2Udt,
    Ratio.from({
      ckbScale: isCkb2Udt ? numerator : denominator,
      udtScale: isCkb2Udt ? denominator : numerator,
    }),
  );
  return { ok: true, convertedAmount, ckbFee, info };
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
      term = ccc.numMin(term, (maxTerm - previousP) / p);
    }
    if (q !== 0n) {
      term = ccc.numMin(term, (maxTerm - previousQ) / q);
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
