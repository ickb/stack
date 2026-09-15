import type { JSX } from "react";
import { conversionQuote, type QuoteStateLike } from "../shared/quote.ts";
import {
  CKB,
  direction2Symbol,
  parseAmountInput,
  symbol2Direction,
  toText,
} from "../shared/utils.ts";
import {
  amountQuoteText,
  formAssets,
  type AssetDisplay,
  type FormBalances,
} from "./formState.ts";

const amountErrorId = "conversion-amount-error";

export default function Form({
  rawText,
  setRawText,
  quoteState,
  isFrozen,
  balances,
}: Readonly<{
  rawText: string;
  setRawText: (value: string) => void;
  quoteState?: QuoteStateLike;
  isFrozen: boolean;
  balances?: FormBalances;
}>): JSX.Element {
  const symbol = rawText.startsWith("I") ? "I" : direction2Symbol(true);
  const text = rawText.slice(1);
  const isCkb2Udt = symbol2Direction(symbol);
  const amountInput = parseAmountInput(text);
  const hasAmountError = amountInput.status === "invalid";
  const amountQuote = amountQuoteText(
    amountInput.amount,
    rawText,
    quoteState,
    amountInput.error,
  );
  const toggle = (): void => {
    setRawText(direction2Symbol(!isCkb2Udt) + text);
  };

  const [a, b] = formAssets(balances, isCkb2Udt);
  const selectMax = maxSelector(a, symbol, setRawText);
  const selectReverseMax = maxSelector(b, direction2Symbol(!isCkb2Udt), setRawText);
  // While the amount box shows its "0" placeholder the quote row shows its own, at the same
  // tint, so the empty form reads as two placeholders rather than two stacked zeros.
  const isPlaceholder = text === "" && !hasAmountError;
  const quoteLine = isPlaceholder ? "0" : amountQuote;
  // The rate for one unit sits beside the direction switch, where the conversion happens.
  // Both figures carry two decimals, so the two sides of the switch are the same length.
  const unitAmount =
    quoteState === undefined
      ? undefined
      : conversionQuote(`${symbol}1`, quoteState).convertedAmount;
  const unitRate =
    unitAmount === undefined ? "..." : `${twoDecimals(unitAmount)} ${b.name}`;

  return (
    <div className="grid w-full min-w-0 grid-cols-3 grid-rows-[1.75rem_3rem_2.75rem_minmax(3.5rem,auto)_1.75rem] items-center justify-items-center gap-y-1.5 overflow-hidden leading-relaxed font-bold tracking-wider uppercase sm:gap-y-2">
      {nativeBalanceDisplay(a, isFrozen, selectMax)}
      <span className="text-2xl text-ickb-text normal-case">{a.name}</span>
      {lockedBalanceDisplay(a)}
      <input
        placeholder="0"
        disabled={isFrozen}
        autoFocus={true}
        value={text}
        onChange={(event) => {
          setRawText(symbol + event.target.value);
        }}
        autoComplete="off"
        inputMode="decimal"
        type="text"
        aria-invalid={hasAmountError}
        aria-describedby={hasAmountError ? amountErrorId : undefined}
        className="col-span-3 w-full rounded border-0 bg-transparent text-center text-3xl text-ickb-action outline-none placeholder:text-ickb-action/35 focus:text-ickb-action disabled:cursor-default"
        aria-label="Amount to be converted"
      />
      {/* The whole rate row is the direction switch: the unit rate takes the balance
          columns, each figure under the balance above it, the arrows take the middle column,
          and the row is outlined in the section-divider line, a full-width target on a phone. */}
      <button
        // The main button's look (buttonStyles.ts) written out, since its own utilities would
        // win over a smaller height, no side padding, and the asset names' case.
        className="col-span-3 grid h-11 w-full cursor-pointer grid-cols-3 items-center justify-items-center rounded border border-ickb-border/70 text-sm leading-relaxed font-bold tracking-wider text-ickb-action normal-case transition-colors duration-150 hover:bg-ickb-action/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action active:bg-ickb-action/15 disabled:cursor-default disabled:opacity-50"
        disabled={isFrozen}
        onClick={toggle}
        aria-label="Switch conversion direction"
        title="Switch conversion direction"
      >
        <span>1.00 {a.name}</span>
        {/* Measured against the amount's "0" in the same font: the glyph's ink sits 3px
            low and its shafts are 3px to the digit's 4.5px, so it is nudged and stroked. */}
        <span
          aria-hidden="true"
          className="-translate-y-[3px] text-3xl leading-none font-bold [-webkit-text-stroke:1.5px_currentColor]"
        >
          ⇅
        </span>
        <span title={unitRate}>{unitRate}</span>
      </button>
      <span
        id={hasAmountError ? amountErrorId : undefined}
        role={hasAmountError ? "alert" : undefined}
        className={`col-span-3 max-w-full text-center normal-case ${isPlaceholder ? "text-ickb-action/35" : "text-ickb-action"} ${hasAmountError ? "w-full px-2 text-base leading-tight break-words whitespace-normal" : "overflow-hidden text-2xl text-ellipsis whitespace-nowrap sm:text-3xl"}`}
        title={quoteLine}
      >
        {quoteLine}
      </span>
      {nativeBalanceDisplay(b, isFrozen, selectReverseMax)}
      <span className="text-2xl whitespace-nowrap text-ickb-text normal-case">
        {b.name}
      </span>
      {lockedBalanceDisplay(b)}
    </div>
  );
}

function nativeBalanceDisplay(
  asset: AssetDisplay,
  isFrozen: boolean,
  selectMax: (() => void) | undefined,
): JSX.Element {
  if (!hasBalance(asset)) {
    return <span aria-hidden="true" />;
  }

  const renderedBalance = display(asset.available, "available", false);
  if (selectMax === undefined) {
    return (
      <span
        className="whitespace-nowrap text-ickb-action"
        aria-label={`Available ${asset.name}: ${toText(asset.available)}`}
      >
        {renderedBalance}
      </span>
    );
  }

  return (
    <button
      className="cursor-pointer rounded whitespace-nowrap text-ickb-action hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action disabled:cursor-default disabled:opacity-50"
      disabled={isFrozen}
      onClick={selectMax}
      aria-label={`Use maximum ${asset.name}: ${toText(asset.available)}`}
    >
      {renderedBalance}
    </button>
  );
}

function maxSelector(
  asset: AssetDisplay,
  symbol: string,
  setRawText: (value: string) => void,
): (() => void) | undefined {
  if (asset.name !== "iCKB" || asset.available === undefined) {
    return undefined;
  }
  const available = asset.available;

  return (): void => {
    setRawText(symbol + toText(available));
  };
}

function hasBalance(asset: AssetDisplay): asset is Required<AssetDisplay> {
  return (
    asset.available !== undefined &&
    asset.locked !== undefined &&
    asset.status !== undefined
  );
}

function lockedBalanceDisplay(asset: AssetDisplay): JSX.Element {
  if (
    asset.available === undefined ||
    asset.locked === undefined ||
    asset.status === undefined
  ) {
    return <span aria-hidden="true" />;
  }

  return (
    <span className="cursor-wait whitespace-nowrap text-ickb-muted">
      {display(asset.locked, asset.status, asset.status === "maturing")}
    </span>
  );
}

/** A figure and the word that says what it is; a maturing figure pulses. */
function display(shannons: bigint, label: string, isMaturing: boolean): JSX.Element {
  return (
    <span
      className={`flex flex-row items-baseline gap-x-1 ${isMaturing ? "cursor-wait" : ""}`}
    >
      <span className={isMaturing ? "animate-pulse motion-reduce:animate-none" : ""}>
        <span className="sm:hidden">
          {String(shannons / CKB)}
          {shannons % CKB === 0n ? "" : "+"}
        </span>
        <span className="hidden sm:block">{toText(shannons)}</span>
      </span>
      <span className="text-xs font-medium tracking-normal normal-case opacity-80">
        {label}
      </span>
    </span>
  );
}

function twoDecimals(shannons: bigint): string {
  const cents = (shannons + CKB / 200n) / (CKB / 100n);
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}
