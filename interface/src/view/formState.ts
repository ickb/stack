import { groupDigits } from "../shared/figures.ts";
import { conversionQuote, type QuoteStateLike } from "../shared/quote.ts";

export interface FormBalances {
  ckbNative: bigint;
  ickbNative: bigint;
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  ckbBalance: bigint;
  ickbBalance: bigint;
}

export interface AssetDisplay {
  name: "CKB" | "iCKB";
  available?: bigint;
  locked?: bigint;
  status?: string;
  /** What the Max control sets: the SDK's own bound, native plus collectable. iCKB only. */
  max?: bigint;
}

export function formAssets(
  balances: FormBalances | undefined,
  isCkb2Udt: boolean,
): readonly [AssetDisplay, AssetDisplay] {
  const ckb: AssetDisplay =
    balances === undefined
      ? { name: "CKB" }
      : assetDisplay(
          "CKB",
          balances.ckbNative,
          balances.ckbAvailable,
          balances.ckbBalance,
        );
  const ickb: AssetDisplay =
    balances === undefined
      ? { name: "iCKB" }
      : assetDisplay(
          "iCKB",
          balances.ickbNative,
          balances.ickbAvailable,
          balances.ickbBalance,
        );
  return isCkb2Udt ? [ckb, ickb] : [ickb, ckb];
}

export function amountQuoteText(
  amount: bigint | undefined,
  rawText: string,
  quoteState: QuoteStateLike | undefined,
  validationError = "",
): string {
  if (amount === undefined) {
    return validationError === "" ? "..." : validationError;
  }
  if (amount === 0n) {
    return "0";
  }

  if (quoteState === undefined) {
    return "...";
  }

  return groupDigits(conversionQuote(rawText, quoteState).outputText);
}

function assetDisplay(
  name: AssetDisplay["name"],
  native: bigint,
  bound: bigint,
  balance: bigint,
): AssetDisplay {
  return {
    name,
    available: native,
    locked: balance - native,
    status: maturityStatus(balance, native, bound),
    // No CKB Max: a request at the CKB bound never funds (decisions amendment 52(z)).
    ...(name === "iCKB" ? { max: bound } : {}),
  };
}

/**
 * The word beside the non-native figure: "collectable" when every part of it returns with the
 * next transaction, else "converting", the middle of a two-step conversion (or nothing at all).
 */
function maturityStatus(balance: bigint, native: bigint, bound: bigint): string {
  return balance !== native && balance === bound ? "collectable" : "converting";
}

/** Where the caret lands in `shown` after `count` of its non-separator characters. */
export function caretAfter(shown: string, count: number): number {
  let seen = 0;
  for (let index = 0; index < shown.length; index += 1) {
    if (seen === count) {
      return index;
    }
    if (shown[index] !== ",") {
      seen += 1;
    }
  }
  return shown.length;
}
