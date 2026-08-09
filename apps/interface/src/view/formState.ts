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
    balances === undefined ? { name: "CKB" } : ckbDisplay(balances);
  const ickb: AssetDisplay =
    balances === undefined ? { name: "iCKB" } : ickbDisplay(balances);
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

function ckbDisplay(balances: FormBalances): AssetDisplay {
  const available = minBigint(balances.ckbAvailable, balances.ckbNative);
  return {
    name: "CKB",
    available,
    locked: balances.ckbBalance - available,
    status: maturityStatus(
      balances.ckbBalance,
      balances.ckbNative,
      balances.ckbAvailable,
    ),
  };
}

function ickbDisplay(balances: FormBalances): AssetDisplay {
  return {
    name: "iCKB",
    available: balances.ickbNative,
    locked: balances.ickbBalance - balances.ickbNative,
    status: maturityStatus(
      balances.ickbBalance,
      balances.ickbNative,
      balances.ickbAvailable,
    ),
  };
}

function minBigint(left: bigint, right: bigint): bigint {
  if (left < right) {
    return left;
  }

  return right;
}

function maturityStatus(balance: bigint, native: bigint, available: bigint): string {
  if (balance === native) {
    return "✅";
  }

  if (balance === available) {
    return "⌛️";
  }

  return "⏳";
}
