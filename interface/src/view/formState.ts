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

  return conversionQuote(rawText, quoteState).outputText;
}

function assetDisplay(
  name: AssetDisplay["name"],
  native: bigint,
  available: bigint,
  balance: bigint,
): AssetDisplay {
  return {
    name,
    available: native,
    locked: balance - native,
    status: maturityStatus(balance, native, available),
  };
}

/** The word beside the locked figure: what the non-native part of the balance is doing. */
function maturityStatus(balance: bigint, native: bigint, available: bigint): string {
  if (balance === native) {
    return "locked";
  }

  if (balance === available) {
    return "collectable";
  }

  return "maturing";
}
