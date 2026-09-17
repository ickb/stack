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
  figureText,
  formAssets,
  phoneFigureText,
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
      {nativeBalanceDisplay(a)}
      {/* The name stays centred in its column; "max" sits just under it. */}
      <span className="relative text-2xl text-ickb-text normal-case">
        {a.name}
        {maxButton(a, symbol, setRawText, isFrozen)}
      </span>
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
          and the row is outlined in the section-divider line, a full-width target on a phone,
          inset 4px a side so the section's clipping edge never crops the outline or the focus ring. */}
      <button
        // The main button's look (buttonStyles.ts) written out, since its own utilities would
        // win over a smaller height, no side padding, and the asset names' case.
        className="col-span-3 grid h-11 w-[calc(100%-0.5rem)] cursor-pointer grid-cols-3 items-center justify-items-center rounded border border-ickb-border/70 text-sm leading-relaxed font-bold tracking-wider text-ickb-action normal-case transition-colors duration-150 hover:bg-ickb-action/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action active:bg-ickb-action/15 disabled:cursor-default disabled:opacity-50"
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
        className={`col-span-3 max-w-full text-center normal-case ${isPlaceholder ? "text-ickb-text/35" : "text-ickb-text"} ${hasAmountError ? "w-full px-2 text-base leading-tight break-words whitespace-normal" : "overflow-hidden text-2xl text-ellipsis whitespace-nowrap sm:text-3xl"}`}
        title={quoteLine}
      >
        {quoteLine}
      </span>
      {nativeBalanceDisplay(b)}
      <span className="text-2xl whitespace-nowrap text-ickb-text normal-case">
        {b.name}
      </span>
      {lockedBalanceDisplay(b)}
    </div>
  );
}

function nativeBalanceDisplay(asset: AssetDisplay): JSX.Element {
  if (!hasBalance(asset)) {
    return <span aria-hidden="true" />;
  }

  return (
    <span
      className="whitespace-nowrap text-ickb-text"
      aria-label={`${asset.name} in wallet: ${toText(asset.available)}`}
    >
      {display(asset.available, "in wallet", false)}
    </span>
  );
}

/**
 * The Max control beside the source asset's name: sets the SDK's own bound for it, native
 * plus collectable. Only the source has one, so it appears while converting from iCKB.
 */
function maxButton(
  asset: AssetDisplay,
  symbol: string,
  setRawText: (value: string) => void,
  isFrozen: boolean,
): JSX.Element | undefined {
  const max = asset.max;
  if (max === undefined) {
    return undefined;
  }

  return (
    <button
      className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1 cursor-pointer rounded text-xs leading-none font-medium tracking-normal text-ickb-action normal-case hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action disabled:cursor-default disabled:opacity-50"
      disabled={isFrozen}
      onClick={() => {
        setRawText(symbol + toText(max));
      }}
      aria-label={`Use maximum ${asset.name}: ${toText(max)}`}
    >
      max
    </button>
  );
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
    <span className="whitespace-nowrap text-ickb-muted">
      {display(
        asset.locked,
        asset.status,
        asset.status === "converting" && asset.locked > 0n,
      )}
    </span>
  );
}

/**
 * A figure and the word that says what it is; a converting figure pulses. On a phone the
 * word sits under the figure, since a 100px column cannot hold both side by side.
 */
function display(shannons: bigint, label: string, isConverting: boolean): JSX.Element {
  return (
    <span
      className={`flex flex-col items-center leading-none sm:flex-row sm:items-baseline sm:gap-x-1 sm:leading-relaxed ${isConverting ? "cursor-wait" : ""}`}
    >
      <span className={isConverting ? "animate-pulse motion-reduce:animate-none" : ""}>
        <span className="sm:hidden">{phoneFigureText(shannons)}</span>
        <span className="hidden sm:block">{figureText(shannons)}</span>
      </span>
      <span className="text-[10px] font-medium tracking-normal normal-case opacity-80 sm:text-xs">
        {label}
      </span>
    </span>
  );
}

function twoDecimals(shannons: bigint): string {
  const cents = (shannons + CKB / 200n) / (CKB / 100n);
  return `${String(cents / 100n)}.${String(cents % 100n).padStart(2, "0")}`;
}
