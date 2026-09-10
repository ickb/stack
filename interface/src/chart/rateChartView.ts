import type { QuoteState } from "../query/queries.ts";
import { CKB, clampShannons, type RootConfig } from "../shared/utils.ts";
import {
  conversionWorthSamples,
  type IckbWorthSample,
  type IckbWorthSamples,
} from "./rateChartData.ts";
import { scaleX, scaleY } from "./rateChartScale.ts";
import { chartAmountText, graphAmountText, valueGridMarks } from "./rateChartText.ts";

interface RateChartViewParams {
  readonly chain: RootConfig["chain"];
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly quoteState?: Pick<QuoteState, "exchangeRatio" | "tipTimestamp">;
  readonly now: Date;
}

export interface RateChartViewState {
  readonly sourceSymbol: "CKB" | "iCKB";
  readonly targetSymbol: "CKB" | "iCKB";
  readonly chartAmount: bigint;
  readonly amountText: string;
  readonly title: string;
  readonly caption: string;
  readonly description: string;
  readonly samples: IckbWorthSamples;
  readonly first: IckbWorthSample;
  readonly tip: IckbWorthSample;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly gridMarks: ReturnType<typeof valueGridMarks>;
  readonly points: string;
}

const chainLabel: Record<RootConfig["chain"], string> = {
  mainnet: "Mainnet",
  testnet: "Testnet",
};

export function rateChartView({
  chain,
  isCkb2Udt,
  amount,
  quoteState,
  now,
}: RateChartViewParams): RateChartViewState {
  const sourceSymbol = isCkb2Udt ? "CKB" : "iCKB";
  const targetSymbol = isCkb2Udt ? "iCKB" : "CKB";
  const chartAmount = amount >= CKB ? clampShannons(amount) : CKB;
  const amountText = chartAmountText(chartAmount);
  const samples = conversionWorthSamples(chain, isCkb2Udt, quoteState, now);
  const xs = samples.map(({ date }) => date.getTime());
  const ys = samples.map(({ value }) => value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const gridMarks = valueGridMarks(minY, maxY, targetSymbol, chartAmount);
  const first = samples[0];
  const tip = samples.reduce((_, sample) => sample);
  const firstValueText = graphAmountText(chartAmount, first.value);
  const tipValueText = graphAmountText(chartAmount, tip.value);

  return {
    sourceSymbol,
    targetSymbol,
    chartAmount,
    amountText,
    title: `${amountText} ${sourceSymbol} worth over time:`,
    caption: isCkb2Udt
      ? "Gross standard-deposit value follows NervosDAO compensation, so CKB converts to less iCKB over time."
      : "Gross standard-deposit value includes recoverable occupied capacity and grows with NervosDAO compensation.",
    description: [
      "Protocol-derived ",
      chainLabel[chain],
      " curve from ",
      String(first.date.getUTCFullYear()),
      " to ",
      String(tip.date.getUTCFullYear()),
      ", showing 1 ",
      sourceSymbol,
      " changing from ",
      firstValueText,
      " ",
      targetSymbol,
      " to ",
      tipValueText,
      " ",
      targetSymbol,
      ".",
    ].join(""),
    samples,
    first,
    tip,
    minX,
    maxX,
    minY,
    maxY,
    gridMarks,
    points: samples
      .map((sample) =>
        [
          String(scaleX(sample.date.getTime(), minX, maxX)),
          String(scaleY(sample.value, minY, maxY)),
        ].join(","),
      )
      .join(" "),
  };
}
