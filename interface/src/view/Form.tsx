import type { JSX } from "react";
import { chartAmountText } from "../chart/rateChartText.ts";
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
  // The quote row stays empty while the amount box shows its placeholder, so the form
  // does not open on two stacked zeros; a typed amount reads as input above, output below.
  const typedQuote = text === "" ? "" : `${amountQuote} ${b.name}`;
  const quoteLine = hasAmountError ? amountQuote : typedQuote;
  // The rate for one unit sits beside the direction switch, where the conversion happens.
  const unitAmount =
    quoteState === undefined
      ? undefined
      : conversionQuote(`${symbol}1`, quoteState).convertedAmount;
  const unitRate =
    unitAmount === undefined ? "..." : `${chartAmountText(unitAmount)} ${b.name}`;

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
      {/* The unit rate and the switch sit between two hairlines, the card's own divider
          language, so the rate reads as one fact apart from the balances above and below;
          equal side columns keep the switch on the form's centre line whatever the two
          figures' widths. */}
      <span className="col-span-3 grid w-full grid-cols-[1fr_auto_1fr] items-center gap-x-4">
        <span aria-hidden="true" className="h-px bg-ickb-border/70" />
        <span className="inline-grid h-11 grid-cols-[1fr_auto_1fr] items-center gap-x-3 text-sm font-medium tracking-normal whitespace-nowrap text-ickb-muted normal-case">
          <span className="justify-self-end">1 {a.name}</span>
          <button
            className="relative h-11 w-11 cursor-pointer rounded border-0 bg-transparent text-3xl leading-none text-ickb-action transition-colors duration-150 hover:bg-ickb-action/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action disabled:cursor-default disabled:opacity-50"
            disabled={isFrozen}
            onClick={toggle}
            aria-label="Switch conversion direction"
            title="Switch conversion direction"
          >
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              ⇅
            </span>
          </button>
          <span className="justify-self-start" title={unitRate}>
            {unitRate}
          </span>
        </span>
        <span aria-hidden="true" className="h-px bg-ickb-border/70" />
      </span>
      <span
        id={hasAmountError ? amountErrorId : undefined}
        role={hasAmountError ? "alert" : undefined}
        className={`col-span-3 max-w-full text-center text-ickb-action normal-case ${hasAmountError ? "w-full px-2 text-base leading-tight break-words whitespace-normal" : "overflow-hidden text-2xl text-ellipsis whitespace-nowrap sm:text-3xl"}`}
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
