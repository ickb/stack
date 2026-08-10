import type { JSX } from "react";
import type { QuoteState } from "../query/queries.ts";
import type { RootConfig } from "../shared/utils.ts";
import {
  chartHeight,
  chartWidth,
  gridLine,
  unscaledTimeLabels,
  unscaledValueLabel,
} from "./rateChartLayout.tsx";
import { scaleX, scaleY } from "./rateChartScale.ts";
import { rateChartView } from "./rateChartView.ts";

interface RateChartProps {
  readonly chain: RootConfig["chain"];
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly quoteState?: Pick<QuoteState, "exchangeRatio" | "tipTimestamp">;
  readonly now?: Date;
}

export default function RateChart({
  chain,
  isCkb2Udt,
  amount,
  quoteState,
  now = new Date(),
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
  } = rateChartView({ chain, isCkb2Udt, amount, quoteState, now });

  return (
    <figure className="grid h-full grid-rows-[2rem_minmax(0,1fr)_4.5rem] sm:grid-rows-[2rem_minmax(0,1fr)_3.25rem]">
      <figcaption className="flex items-end justify-center text-center">
        <span className="text-lg font-medium text-ickb-text/90">
          <span className="text-xl font-bold text-ickb-action">
            {amountText} {sourceSymbol}
          </span>{" "}
          worth over time:
        </span>
      </figcaption>
      <div className="grid min-h-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        <div className="relative min-h-0">
          {gridMarks.map(({ value, label }, index) =>
            unscaledValueLabel({ value, minY, maxY, label, index }),
          )}
        </div>
        <div className="relative min-h-0">
          {/* Stretch the plot layer horizontally while keeping text labels unscaled. */}
          <svg
            viewBox={["0", "0", String(chartWidth), String(chartHeight)].join(" ")}
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
              className="text-ickb-action"
            />
          </svg>
          {/* Unscaled end-dot marks the live tip of the curve. */}
          <span
            aria-hidden="true"
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ickb-action ring-2 ring-ickb-panel"
            style={{
              left: `${String((scaleX(tip.date.getTime(), minX, maxX) / chartWidth) * 100)}%`,
              top: `${String((scaleY(tip.value, minY, maxY) / chartHeight) * 100)}%`,
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
