import type { JSX } from "react";
import {
  chartHeight,
  chartWidth,
  padding,
  plotPadding,
  scaleX,
  scaleY,
} from "./rateChartScale.ts";

export { chartHeight, chartWidth };

export function unscaledTimeLabels(minX: number, maxX: number): JSX.Element[] {
  const firstYear = new Date(minX).getUTCFullYear();
  const lastYear = new Date(maxX).getUTCFullYear();
  const marks = [
    { label: String(firstYear), value: minX, anchor: "start" },
    {
      label: String(new Date((minX + maxX) / 2).getUTCFullYear()),
      value: (minX + maxX) / 2,
      anchor: "middle",
    },
    { label: String(lastYear), value: maxX, anchor: "end" },
  ] as const;
  const y = chartHeight - padding.bottom + 20;

  return marks.map(({ label, value, anchor }) => {
    const x = scaleX(value, minX, maxX);
    return (
      <span
        key={["time", label, String(value)].join(":")}
        className={`absolute text-base whitespace-nowrap text-ickb-muted ${timeLabelClass(anchor)}`}
        style={{
          left: `${String((x / chartWidth) * 100)}%`,
          top: `${String((y / chartHeight) * 100)}%`,
        }}
      >
        {label}
      </span>
    );
  });
}

export function gridLine(value: number, minY: number, maxY: number): JSX.Element {
  const y = scaleY(value, minY, maxY);
  return (
    <g key={["value", String(value)].join(":")}>
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

interface ValueLabelParams {
  readonly value: number;
  readonly minY: number;
  readonly maxY: number;
  readonly label: string;
  readonly index: number;
}

export function unscaledValueLabel({
  value,
  minY,
  maxY,
  label,
  index,
}: ValueLabelParams): JSX.Element {
  const y = scaleY(value, minY, maxY);
  return (
    <span
      key={["label", String(index), String(value)].join(":")}
      className="absolute right-0 translate-y-[-50%] text-base whitespace-nowrap text-ickb-muted"
      style={{ top: `${String((y / chartHeight) * 100)}%` }}
    >
      {label}
    </span>
  );
}

function timeLabelClass(anchor: "start" | "middle" | "end"): string {
  if (anchor === "start") {
    return "translate-y-[-50%]";
  }
  if (anchor === "end") {
    return "translate-x-[-100%] translate-y-[-50%]";
  }
  return "translate-x-[-50%] translate-y-[-50%]";
}
