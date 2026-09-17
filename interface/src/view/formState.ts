import { conversionQuote, type QuoteStateLike } from "../shared/quote.ts";
import { CKB, toText } from "../shared/utils.ts";

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

  return conversionQuote(rawText, quoteState).outputText;
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

/** The figure at full precision with thousands grouped, for a wide screen. */
export function figureText(shannons: bigint): string {
  const [whole = "0", fraction] = toText(shannons).split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/**
 * The figure a phone column holds: whole units, "+" for any fraction, and a compact form
 * from eight digits (the column is about 100px; "1,234,567+" is 90px, one digit more fills it).
 */
export function phoneFigureText(shannons: bigint): string {
  const whole = shannons / CKB;
  if (whole >= 10_000_000n) {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumSignificantDigits: 3,
    }).format(whole);
  }
  return `${whole.toLocaleString("en-US")}${shannons % CKB === 0n ? "" : "+"}`;
}
