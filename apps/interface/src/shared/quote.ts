import { OrderManager, type Ratio } from "@ickb/order";
import { direction2Symbol, parseAmountInput, toText } from "./utils.ts";

export interface QuoteDraft {
  isCkb2Udt: boolean;
  amount: bigint | undefined;
  validationError: string;
}

export interface ConversionQuote {
  outputText: string;
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
  let quote: ReturnType<typeof OrderManager.convert>;
  try {
    quote = OrderManager.convert(
      draft.isCkb2Udt,
      state.exchangeRatio,
      {
        ckbValue: draft.isCkb2Udt ? draft.amount : 0n,
        udtValue: draft.isCkb2Udt ? 0n : draft.amount,
      },
      { fee: 1n, feeBase: 100000n },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "OrderConversionRepresentabilityError") {
      return { outputText: "..." };
    }
    throw error;
  }

  return {
    outputText: toText(quote.convertedAmount),
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
