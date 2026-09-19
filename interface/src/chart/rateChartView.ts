import type { QuoteState } from "../query/queries.ts";
import { chartAmountText, graphAmountText } from "../shared/figures.ts";
import { CKB, clampShannons, type RootConfig } from "../shared/utils.ts";
import { conversionWorthSamples, type IckbWorthSample } from "./rateChartData.ts";
import { scaleX, scaleY } from "./rateChartScale.ts";
import { valueGridMarks } from "./rateChartText.ts";

interface RateChartViewParams {
  readonly chain: RootConfig["chain"];
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly quoteState?: QuoteState;
}

export interface RateChartViewState {
  readonly sourceSymbol: "CKB" | "iCKB";
  readonly amountText: string;
  readonly title: string;
  readonly caption: string;
  readonly description: string;
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
}: RateChartViewParams): RateChartViewState {
  const sourceSymbol = isCkb2Udt ? "CKB" : "iCKB";
  const targetSymbol = isCkb2Udt ? "iCKB" : "CKB";
  const chartAmount = amount >= CKB ? clampShannons(amount) : CKB;
  const amountText = chartAmountText(chartAmount);
  const samples = conversionWorthSamples(chain, isCkb2Udt, quoteState);
  const xs = samples.map(({ date }) => date.getTime());
  const ys = samples.map(({ value }) => value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const first = samples[0];
  const tip = samples.reduce((_, sample) => sample);

  return {
    sourceSymbol,
    amountText,
    title: `${amountText} ${sourceSymbol} worth over time:`,
    caption: isCkb2Udt
      ? "iCKB earns NervosDAO compensation, so 1 CKB buys a little less iCKB every day."
      : "iCKB earns NervosDAO compensation, so 1 iCKB is worth a little more CKB every day.",
    description: `Protocol-derived ${chainLabel[chain]} curve from ${String(first.date.getUTCFullYear())} to ${String(tip.date.getUTCFullYear())}, showing ${amountText} ${sourceSymbol} changing from ${graphAmountText(chartAmount, first.value)} ${targetSymbol} to ${graphAmountText(chartAmount, tip.value)} ${targetSymbol}.`,
    tip,
    minX,
    maxX,
    minY,
    maxY,
    gridMarks: valueGridMarks(minY, maxY, targetSymbol, chartAmount),
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
