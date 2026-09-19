import type { AccountAvailabilityProjection, Ratio } from "@ickb/sdk";
import type { JSX } from "react";
import { figureText, groupDigits, phoneFigureText } from "../shared/figures.ts";
import { conversionQuote } from "../shared/quote.ts";
import {
  CKB,
  parseAmountInput,
  type RootConfig,
  toText,
  twoDecimals,
} from "../shared/utils.ts";
import {
  amountQuoteText,
  type AssetDisplay,
  caretAfter,
  formAssets,
} from "./formState.ts";

const amountErrorId = "conversion-amount-error";

export default function Form({
  isCkb2Udt,
  setIsCkb2Udt,
  text,
  setText,
  exchangeRatio,
  isFrozen,
  projection,
  chain,
}: Readonly<{
  isCkb2Udt: boolean;
  setIsCkb2Udt: (value: boolean) => void;
  text: string;
  setText: (value: string) => void;
  exchangeRatio?: Ratio;
  isFrozen: boolean;
  projection?: AccountAvailabilityProjection;
  chain: RootConfig["chain"];
}>): JSX.Element {
  const amountInput = parseAmountInput(text);
  const hasAmountError = amountInput.status === "invalid";
  const amountQuote = amountQuoteText(isCkb2Udt, amountInput, exchangeRatio);

  const [a, b] = formAssets(projection, isCkb2Udt);
  // While the amount box shows its "0" placeholder the quote row shows its own, at the same
  // tint, so the empty form reads as two placeholders rather than two stacked zeros.
  const isPlaceholder = text === "" && !hasAmountError;
  const quoteLine = isPlaceholder ? "0" : amountQuote;
  // The rate for one unit sits beside the direction switch, where the conversion happens.
  // Both figures carry two decimals, so the two sides of the switch are the same length.
  const unitAmount =
    exchangeRatio === undefined
      ? undefined
      : conversionQuote(isCkb2Udt, CKB, exchangeRatio);
  const unitRate =
    unitAmount === undefined ? "..." : `${twoDecimals(unitAmount)} ${b.name}`;

  return (
    <div className="grid w-full min-w-0 grid-cols-3 grid-rows-[1.75rem_3rem_2.75rem_minmax(3.5rem,auto)_1.75rem] items-center justify-items-center gap-y-1.5 overflow-hidden leading-relaxed font-bold tracking-wider uppercase sm:gap-y-2">
      {availableDisplay(a)}
      {/* The name stays centred in its column; its control, "max" under the source iCKB
          or "faucet" under CKB on testnet, sits just under it. */}
      <span className="relative text-2xl text-ickb-text normal-case">
        {a.name}
        {a.name === "iCKB" ? maxButton(a, setText, isFrozen) : faucetLink(chain)}
      </span>
      {lockedBalanceDisplay(a)}
      <input
        placeholder="0"
        disabled={isFrozen}
        autoFocus={true}
        value={groupDigits(text)}
        // The box shows the digits grouped; the commas never reach the raw text. A comma
        // appearing or vanishing mid-string would throw the caret to the end, so once the
        // synchronous re-render has set the grouped value, the caret goes back after the
        // same count of non-comma characters it followed. A microtask runs before paint.
        onChange={(event) => {
          const { target } = event;
          const { value, selectionStart } = target;
          const count = value
            .slice(0, selectionStart ?? value.length)
            .replaceAll(",", "").length;
          setText(value.replaceAll(",", ""));
          queueMicrotask(() => {
            const position = caretAfter(target.value, count);
            target.setSelectionRange(position, position);
          });
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
        onClick={() => {
          setIsCkb2Udt(!isCkb2Udt);
        }}
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
      >
        {quoteLine}
      </span>
      {availableDisplay(b)}
      <span className="relative text-2xl whitespace-nowrap text-ickb-text normal-case">
        {b.name}
        {b.name === "CKB" ? faucetLink(chain) : undefined}
      </span>
      {lockedBalanceDisplay(b)}
    </div>
  );
}

function availableDisplay({ name, balance }: AssetDisplay): JSX.Element {
  if (balance === undefined) {
    return <span aria-hidden="true" />;
  }

  return (
    <span
      className="whitespace-nowrap text-ickb-text"
      aria-label={`${name} in wallet: ${toText(balance.available)}`}
    >
      {display(balance.available, "in wallet", false)}
    </span>
  );
}

/** The small accent control under an asset's name, centred, in the label style. */
const underNameClass =
  "absolute top-full left-1/2 -translate-x-1/2 -translate-y-1 cursor-pointer rounded text-xs leading-none font-medium tracking-normal text-ickb-action normal-case hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ickb-action";

/** Testnet CKB comes from the faucet, so the link sits under "CKB" wherever it is. */
function faucetLink(chain: RootConfig["chain"]): JSX.Element | undefined {
  if (chain !== "testnet") {
    return undefined;
  }

  return (
    <a
      href="https://faucet.nervos.org/"
      target="_blank"
      rel="noopener noreferrer"
      className={underNameClass}
      aria-label="Open testnet faucet"
    >
      faucet
    </a>
  );
}

/**
 * The Max control beside the source asset's name: sets the SDK's own bound for it, native
 * plus collectable. Only the source has one, so it appears while converting from iCKB.
 */
function maxButton(
  asset: AssetDisplay,
  setText: (value: string) => void,
  isFrozen: boolean,
): JSX.Element | undefined {
  const max = asset.max;
  if (max === undefined) {
    return undefined;
  }

  return (
    <button
      className={`${underNameClass} disabled:cursor-default disabled:opacity-50`}
      disabled={isFrozen}
      onClick={() => {
        setText(toText(max));
      }}
      aria-label={`Use maximum ${asset.name}: ${toText(max)}`}
    >
      max
    </button>
  );
}

function lockedBalanceDisplay({ balance }: AssetDisplay): JSX.Element {
  if (balance === undefined) {
    return <span aria-hidden="true" />;
  }

  return (
    <span className="whitespace-nowrap text-ickb-muted">
      {display(
        balance.locked,
        balance.status,
        balance.status === "converting" && balance.locked > 0n,
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
