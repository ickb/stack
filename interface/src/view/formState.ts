import type { AccountAvailabilityProjection, Ratio } from "@ickb/sdk";
import { groupDigits } from "../shared/figures.ts";
import { conversionQuote } from "../shared/quote.ts";
import { twoDecimals, type AmountInput } from "../shared/utils.ts";

export interface AssetDisplay {
  name: "CKB" | "iCKB";
  balance?: { available: bigint; locked: bigint; status: string };
  /** What the Max control sets: the SDK's own bound, native plus collectable. iCKB only. */
  max?: bigint;
}

export function formAssets(
  projection: AccountAvailabilityProjection | undefined,
  isCkb2Udt: boolean,
): readonly [AssetDisplay, AssetDisplay] {
  const ckb: AssetDisplay =
    projection === undefined
      ? { name: "CKB" }
      : {
          name: "CKB",
          balance: balanceDisplay(
            projection.ckbNative,
            projection.ckbAvailable,
            projection.ckbBalance,
          ),
          // No CKB Max: a request at the CKB bound never funds (decisions amendment 52(z)).
        };
  const ickb: AssetDisplay =
    projection === undefined
      ? { name: "iCKB" }
      : {
          name: "iCKB",
          balance: balanceDisplay(
            projection.ickbNative,
            projection.ickbAvailable,
            projection.ickbBalance,
          ),
          max: projection.ickbAvailable,
        };
  return isCkb2Udt ? [ckb, ickb] : [ickb, ckb];
}

export function amountQuoteText(
  isCkb2Udt: boolean,
  { amount, error }: AmountInput,
  exchangeRatio: Ratio | undefined,
): string {
  if (amount === undefined) {
    return error === "" ? "..." : error;
  }
  if (amount === 0n) {
    return "0";
  }

  const quoted =
    exchangeRatio === undefined
      ? undefined
      : conversionQuote(isCkb2Udt, amount, exchangeRatio);
  // The quote is an estimate: two decimals on screen, the exact figure beside it.
  return quoted === undefined ? "..." : groupDigits(twoDecimals(quoted));
}

/**
 * The word beside the non-native figure: "collectable" when every part of it returns with the
 * next transaction, else "converting", the middle of a two-step conversion (or nothing at all).
 */
function balanceDisplay(
  native: bigint,
  bound: bigint,
  balance: bigint,
): NonNullable<AssetDisplay["balance"]> {
  return {
    available: native,
    locked: balance - native,
    status: balance !== native && balance === bound ? "collectable" : "converting",
  };
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
