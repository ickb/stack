import { ickb } from "@ickb/sdk";
import { twoDecimals } from "../shared/figures.ts";
import type { AmountInput } from "../shared/utils.ts";

export interface AssetDisplay {
  name: "CKB" | "iCKB";
  balance?: { available: bigint; locked: bigint; status: string };
  /** What the Max control sets: the SDK's own bound for the asset. */
  max?: bigint;
}

export function formAssets(
  state: ickb.State | undefined,
  isCkb2Udt: boolean,
): readonly [AssetDisplay, AssetDisplay] {
  const ckb: AssetDisplay =
    state === undefined
      ? { name: "CKB" }
      : {
          name: "CKB",
          balance: balanceDisplay(state.ckbNative, state.ckbAvailable, state.ckbBalance),
          max: state.ckbConvertible,
        };
  const ickbAsset: AssetDisplay =
    state === undefined
      ? { name: "iCKB" }
      : {
          name: "iCKB",
          balance: balanceDisplay(
            state.ickbNative,
            state.ickbAvailable,
            state.ickbBalance,
          ),
          max: state.ickbConvertible,
        };
  return isCkb2Udt ? [ckb, ickbAsset] : [ickbAsset, ckb];
}

export function amountQuoteText(
  isCkb2Udt: boolean,
  { amount, error }: AmountInput,
  exchangeRatio: ickb.ExchangeRatio | undefined,
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
  return quoted === undefined ? "..." : twoDecimals(quoted);
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
  // One step past the end changes nothing: the count is reached there or the length returned.
  // Stryker disable next-line EqualityOperator: see above.
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

/**
 * The output of converting `amount` at the default order fee, in shannons, without building
 * a transaction; undefined when no order can represent the amount.
 */
export function conversionQuote(
  isCkb2Udt: boolean,
  amount: bigint,
  exchangeRatio: ickb.ExchangeRatio,
): bigint | undefined {
  const quote = ickb.quoteConversion(
    isCkb2Udt ? "ckb-to-ickb" : "ickb-to-ckb",
    exchangeRatio,
    amount,
  );
  return quote.ok ? quote.convertedAmount : undefined;
}
