import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
  quoteConversion,
  type Ratio,
} from "@ickb/sdk";
import { direction2Symbol, parseAmountInput, twoDecimals } from "./utils.ts";

interface QuoteDraft {
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  validationError: string;
}

export interface ConversionQuote {
  outputText: string;
  /** The quoted output in shannons, when the draft quoted at all. */
  convertedAmount?: bigint;
}

export interface QuoteStateLike {
  exchangeRatio: Ratio;
}

/**
 * Computes a lightweight quote for display without building a transaction.
 */
export function conversionQuote(rawText: string, state: QuoteStateLike): ConversionQuote {
  const draft = quoteDraft(rawText);
  if (draft.amount === undefined) {
    return { outputText: draft.validationError === "" ? "..." : draft.validationError };
  }
  let quote: ReturnType<typeof quoteConversion>;
  try {
    quote = quoteConversion(
      draft.isCkb2Udt,
      state.exchangeRatio,
      {
        ckbValue: draft.isCkb2Udt ? draft.amount : 0n,
        udtValue: draft.isCkb2Udt ? 0n : draft.amount,
      },
      { fee: DEFAULT_ORDER_FEE, feeBase: DEFAULT_ORDER_FEE_BASE },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "OrderConversionRepresentabilityError") {
      return { outputText: "..." };
    }
    throw error;
  }

  // The quote is an estimate: two decimals on screen, the exact figure beside it.
  return {
    outputText: twoDecimals(quote.convertedAmount),
    convertedAmount: quote.convertedAmount,
  };
}

/**
 * Parses form text without changing the user's input.
 */
export function quoteDraft(rawText: string): QuoteDraft {
  const symbol = rawText.startsWith("I") ? "I" : direction2Symbol(true);
  const amountInput = parseAmountInput(rawText.slice(1));
  return {
    isCkb2Udt: symbol !== "I",
    amount: amountInput.amount,
    validationError: amountInput.error,
  };
}
