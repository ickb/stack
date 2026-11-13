import type { JSX } from "react";
import type { QuoteState } from "../app/queries.ts";
import type { RootConfig } from "../shared/utils.ts";
import {
  chartHeight,
  chartWidth,
  padding,
  plotPadding,
  rateChartView,
  scaleX,
  scaleY,
} from "./model.ts";

interface RateChartProps {
  readonly chain: RootConfig["chain"];
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly quoteState?: QuoteState;
}

export default function RateChart({
  chain,
  isCkb2Udt,
  amount,
  quoteState,
}: RateChartProps): JSX.Element {
  const {
    sourceSymbol,
    amountText,
    title,
    caption,
    description,
    gridMarks,
    minX,
    maxX,
    minY,
    maxY,
    points,
    tip,
  } = rateChartView({ chain, isCkb2Udt, amount, quoteState });

  return (
    <figure className="grid h-full grid-rows-[2rem_minmax(0,1fr)_4.5rem] sm:grid-rows-[2rem_minmax(0,1fr)_3.25rem]">
      <figcaption className="flex items-end justify-center text-center">
        <span className="text-lg font-medium text-ickb-text/90">
          <span className="text-xl font-bold text-ickb-text">
            {amountText} {sourceSymbol}
          </span>{" "}
          worth over time
        </span>
      </figcaption>
      <div className="grid min-h-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <div className="relative min-h-0">
          {gridMarks.map(({ value, label }) =>
            unscaledValueLabel(value, label, minY, maxY),
          )}
        </div>
        <div className="relative min-h-0">
          {/* Stretch the plot layer horizontally while keeping text labels unscaled. */}
          <svg
            viewBox={`0 0 ${String(chartWidth)} ${String(chartHeight)}`}
            preserveAspectRatio="none"
            role="img"
            aria-labelledby="rate-chart-title rate-chart-desc"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <title id="rate-chart-title">{title}</title>
            <desc id="rate-chart-desc">{description}</desc>
            {gridMarks.map(({ value }) => gridLine(value, minY, maxY))}
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              // The curve is a fact, not a control: it wears the muted ink, not the accent.
              className="text-ickb-muted"
            />
          </svg>
          {/* Unscaled end-dot marks the live tip of the curve. */}
          <span
            aria-hidden="true"
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ickb-text ring-2 ring-ickb-panel"
            style={{
              left: percent(scaleX(tip.date.getTime(), minX, maxX), chartWidth),
              top: percent(scaleY(tip.value, minY, maxY), chartHeight),
            }}
          />
          {unscaledTimeLabels(minX, maxX)}
        </div>
      </div>
      <p
        className="mx-auto max-w-xl text-center text-sm leading-snug [text-wrap:pretty] text-ickb-muted"
        title={caption}
      >
        {caption}
      </p>
    </figure>
  );
}

function unscaledTimeLabels(minX: number, maxX: number): JSX.Element[] {
  const firstYear = new Date(minX).getUTCFullYear();
  const lastYear = new Date(maxX).getUTCFullYear();
  // Each label is anchored at its own edge: the first starts at its point, the last ends at it.
  const marks = [
    { label: String(firstYear), value: minX, anchor: "translate-y-[-50%]" },
    {
      label: String(new Date((minX + maxX) / 2).getUTCFullYear()),
      value: (minX + maxX) / 2,
      anchor: "translate-x-[-50%] translate-y-[-50%]",
    },
    {
      label: String(lastYear),
      value: maxX,
      anchor: "translate-x-[-100%] translate-y-[-50%]",
    },
  ];
  const top = percent(chartHeight - padding.bottom + 20, chartHeight);

  return marks.map(({ label, value, anchor }) => (
    // Two labels can share a year; their points never coincide.
    <span
      key={value}
      className={`absolute text-sm whitespace-nowrap text-ickb-muted sm:text-base ${anchor}`}
      style={{ left: percent(scaleX(value, minX, maxX), chartWidth), top }}
    >
      {label}
    </span>
  ));
}

function gridLine(value: number, minY: number, maxY: number): JSX.Element {
  const y = scaleY(value, minY, maxY);
  return (
    <g key={value}>
      <line
        x1={plotPadding.left}
        x2={chartWidth - plotPadding.right}
        y1={y}
        y2={y}
        vectorEffect="non-scaling-stroke"
        className="stroke-ickb-border/60"
      />
    </g>
  );
}

function unscaledValueLabel(
  value: number,
  label: string,
  minY: number,
  maxY: number,
): JSX.Element {
  return (
    <span
      key={value}
      className="absolute right-0 translate-y-[-50%] text-sm whitespace-nowrap text-ickb-muted sm:text-base"
      style={{ top: percent(scaleY(value, minY, maxY), chartHeight) }}
    >
      {label}
    </span>
  );
}

/** A plot coordinate as a CSS percentage of the chart box, for the unscaled overlays. */
function percent(coordinate: number, size: number): string {
  return `${String((coordinate / size) * 100)}%`;
}
