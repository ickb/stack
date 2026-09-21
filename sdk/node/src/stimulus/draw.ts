import { ccc } from "@ckb-ccc/core";
import { DEFAULT_ORDER_FEE } from "../../../src/conversion/estimate.ts";
import type { ConversionDirection } from "../../../src/conversion/types.ts";
import { convert } from "../../../src/udt.ts";
import type { ExchangeRatio } from "../../../src/utils/utils.ts";

export type Kind = "order" | "conversion";

/** One turn's random choices; `fee` is the order's incentive numerator over the SDK's fee base. */
export type Draw =
  | { kind: "order"; direction: ConversionDirection; amount: bigint; fee: bigint }
  | { kind: "conversion"; direction: ConversionDirection; amount: bigint };

/** Knobs that pin one draw each; see `readStimulusOverride`. */
export interface Override {
  kind?: Kind;
  direction?: ConversionDirection;
  amount?: bigint | "max";
  fee?: bigint;
}

/** What the turn may spend on each side: plain CKB above the reserve, and iCKB. */
export interface Budgets {
  ckb: bigint;
  ickb: bigint;
  ratio: ExchangeRatio;
}

export const RANDOM_BITS = 52n;
const CKB = ccc.fixedPointFrom(1);
// Three kinds of order per conversion: orders are what the bot matches, conversions are
// what it competes with.
const ORDER_WEIGHT = 3;
// Zero pays nothing, the SDK default is what a user's order pays, ten times it is
// generous; no fixed set lands on both sides of the bot's fee check for every transaction
// size, so `STIMULUS_FEE` is the lever when a reason never shows (decisions amendment 48).
// A buy at zero fee is never taken, since the DAO ratio only grows past it, so buys draw
// from the positive fees.
const POSITIVE_FEE_CHOICES: Choices<bigint> = [
  { value: DEFAULT_ORDER_FEE, weight: 2 },
  { value: 10n * DEFAULT_ORDER_FEE, weight: 1 },
];
const FEE_CHOICES: Choices<bigint> = [{ value: 0n, weight: 1 }, ...POSITIVE_FEE_CHOICES];
// One draw in eight is the smallest positive amount and one in eight the whole budget;
// the rest spread evenly across the decades from one CKB up, so dust, mid, and
// whole-balance stimulus all recur without one crowding out the others.
const ENDPOINT_WEIGHT = 1;
const INTERIOR_WEIGHT = 6;
const RANDOM_SCALE = 1n << RANDOM_BITS;

/**
 * Draws the turn's kind, direction, amount, and fee from the budgets, honouring any
 * pinned knob. Returns `undefined` when neither side has anything to spend.
 */
export function drawTurn(
  budgets: Budgets,
  override: Override,
  random: () => number,
): Draw | undefined {
  const direction = override.direction ?? drawConversionDirection(budgets, random);
  if (direction === undefined) {
    return undefined;
  }
  const budget = direction === "ckb-to-ickb" ? budgets.ckb : budgets.ickb;
  if (budget <= 0n && override.amount === undefined) {
    return undefined;
  }
  const amount =
    override.amount === undefined || override.amount === "max"
      ? drawAmount(budget, override.amount === "max", random)
      : override.amount;
  const kind =
    override.kind ??
    pickWeighted(
      [
        { value: "order", weight: ORDER_WEIGHT },
        { value: "conversion", weight: 1 },
      ],
      random,
    );
  if (kind === "conversion") {
    return { kind, direction, amount };
  }
  const fee =
    override.fee ??
    pickWeighted(
      direction === "ckb-to-ickb" ? POSITIVE_FEE_CHOICES : FEE_CHOICES,
      random,
    );
  return { kind, direction, amount, fee };
}

function drawConversionDirection(
  budgets: Budgets,
  random: () => number,
): ConversionDirection | undefined {
  const ckbWeight = budgets.ckb;
  const ickbWeight = convert(false, budgets.ickb, budgets.ratio);
  const total = ckbWeight + ickbWeight;
  if (total <= 0n) {
    return undefined;
  }
  return uniformBelow(total, random) < ckbWeight ? "ckb-to-ickb" : "ickb-to-ckb";
}

function drawAmount(budget: bigint, isMax: boolean, random: () => number): bigint {
  if (isMax || budget <= CKB) {
    return budget;
  }
  const bucket = pickWeighted(
    [
      { value: "min", weight: ENDPOINT_WEIGHT },
      { value: "max", weight: ENDPOINT_WEIGHT },
      { value: "interior", weight: INTERIOR_WEIGHT },
    ],
    random,
  );
  if (bucket === "min") {
    return 1n;
  }
  if (bucket === "max") {
    return budget;
  }
  return logUniform(CKB, budget, random);
}

/** Uniform over bit lengths, then uniform within the chosen length, clamped to the range. */
function logUniform(minimum: bigint, maximum: bigint, random: () => number): bigint {
  const lowBits = minimum.toString(2).length;
  const highBits = maximum.toString(2).length;
  const bits = BigInt(lowBits + Math.floor(random() * (highBits - lowBits + 1)));
  const low = 1n << (bits - 1n);
  const sample = low + uniformBelow(low, random);
  if (sample < minimum) {
    return minimum;
  }
  return sample > maximum ? maximum : sample;
}

function uniformBelow(bound: bigint, random: () => number): bigint {
  const scaled = BigInt(Math.floor(random() * Number(RANDOM_SCALE)));
  return (bound * scaled) >> RANDOM_BITS;
}

interface Choice<T> {
  value: T;
  weight: number;
}
type Choices<T> = readonly [Choice<T>, ...Array<Choice<T>>];

/** The first choice takes whatever the rest leave, so no floating-point edge needs a fallback. */
function pickWeighted<T>(choices: Choices<T>, random: () => number): T {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let point = random() * total;
  for (const choice of choices.slice(1)) {
    if (point < choice.weight) {
      return choice.value;
    }
    point -= choice.weight;
  }
  return choices[0].value;
}
