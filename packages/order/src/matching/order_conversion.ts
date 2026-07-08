import type { ccc } from "@ckb-ccc/core";
import { Ratio } from "../model/ratio.ts";

const maxUint64 = (1n << 64n) - 1n;

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
  if (numerator <= 0n || denominator <= 0n) {
    throw new OrderConversionRepresentabilityError();
  }
  if ((quotedOutput - 1n) * denominator >= inputAmount * numerator) {
    throw new OrderConversionRepresentabilityError();
  }

  return Ratio.from({
    ckbScale: isCkb2Udt ? numerator : denominator,
    udtScale: isCkb2Udt ? denominator : numerator,
  });
}

/**
 * Error thrown when an exact quote cannot be represented by the order ratio format.
 *
 * @public
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

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function greatestBoundedFractionAtMost(
  numerator: bigint,
  denominator: bigint,
  maxTerm: bigint,
): { numerator: bigint; denominator: bigint } {
  const target = { numerator, denominator };
  let state = initialBoundedFractionState(numerator, denominator);
  while (state.remainingDenominator !== 0n) {
    const step = boundedFractionStep(state, target, maxTerm);
    state = step.state;
    if (step.done) {
      break;
    }
  }

  return { numerator: state.bestNumerator, denominator: state.bestDenominator };
}

interface BoundedFractionState {
  previousNumerator: bigint;
  previousDenominator: bigint;
  currentNumerator: bigint;
  currentDenominator: bigint;
  bestNumerator: bigint;
  bestDenominator: bigint;
  remainingNumerator: bigint;
  remainingDenominator: bigint;
}

interface BoundedFraction {
  numerator: bigint;
  denominator: bigint;
}

function initialBoundedFractionState(
  numerator: bigint,
  denominator: bigint,
): BoundedFractionState {
  return {
    previousNumerator: 0n,
    previousDenominator: 1n,
    currentNumerator: 1n,
    currentDenominator: 0n,
    bestNumerator: 0n,
    bestDenominator: 1n,
    remainingNumerator: numerator,
    remainingDenominator: denominator,
  };
}

function boundedFractionStep(
  state: BoundedFractionState,
  target: BoundedFraction,
  maxTerm: bigint,
): { state: BoundedFractionState; done: boolean } {
  const quotient = state.remainingNumerator / state.remainingDenominator;
  const nextNumerator = quotient * state.currentNumerator + state.previousNumerator;
  const nextDenominator = quotient * state.currentDenominator + state.previousDenominator;
  if (nextNumerator <= maxTerm && nextDenominator <= maxTerm) {
    return {
      state: advanceBoundedFractionState(
        state,
        { numerator: nextNumerator, denominator: nextDenominator },
        target,
      ),
      done: false,
    };
  }

  return {
    state: clampBoundedFractionState(state, quotient, target, maxTerm),
    done: true,
  };
}

function advanceBoundedFractionState(
  state: BoundedFractionState,
  next: BoundedFraction,
  target: BoundedFraction,
): BoundedFractionState {
  const best = betterBoundedFraction(state, next, target);
  return {
    previousNumerator: state.currentNumerator,
    previousDenominator: state.currentDenominator,
    currentNumerator: next.numerator,
    currentDenominator: next.denominator,
    bestNumerator: best.numerator,
    bestDenominator: best.denominator,
    remainingNumerator: state.remainingDenominator,
    remainingDenominator: state.remainingNumerator % state.remainingDenominator,
  };
}

function clampBoundedFractionState(
  state: BoundedFractionState,
  quotient: bigint,
  target: BoundedFraction,
  maxTerm: bigint,
): BoundedFractionState {
  const termLimit = boundedFractionTermLimit(state, quotient, maxTerm);
  if (termLimit <= 0n) {
    return state;
  }

  const candidateNumerator = termLimit * state.currentNumerator + state.previousNumerator;
  const candidateDenominator =
    termLimit * state.currentDenominator + state.previousDenominator;
  const best = betterBoundedFraction(
    state,
    { numerator: candidateNumerator, denominator: candidateDenominator },
    target,
  );
  return {
    ...state,
    bestNumerator: best.numerator,
    bestDenominator: best.denominator,
  };
}

function boundedFractionTermLimit(
  state: BoundedFractionState,
  quotient: bigint,
  maxTerm: bigint,
): bigint {
  let termLimit = quotient;
  if (state.currentNumerator !== 0n) {
    termLimit = minBigInt(
      termLimit,
      (maxTerm - state.previousNumerator) / state.currentNumerator,
    );
  }
  if (state.currentDenominator !== 0n) {
    termLimit = minBigInt(
      termLimit,
      (maxTerm - state.previousDenominator) / state.currentDenominator,
    );
  }
  return termLimit;
}

function betterBoundedFraction(
  state: BoundedFractionState,
  candidate: BoundedFraction,
  target: BoundedFraction,
): BoundedFraction {
  return candidate.numerator * target.denominator <=
    candidate.denominator * target.numerator
    ? candidate
    : { numerator: state.bestNumerator, denominator: state.bestDenominator };
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
