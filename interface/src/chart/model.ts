import type { QuoteState } from "../app/queries.ts";
import { chartAmountText, compactText, graphAmountText } from "../shared/figures.ts";
import { CKB, clampShannons, type RootConfig } from "../shared/utils.ts";

export const chartWidth = 640;
export const chartHeight = 132;
export const padding = {
  top: 18,
  bottom: 34,
};
export const plotPadding = {
  left: 10,
  right: 34,
};

export function scaleX(value: number, min: number, max: number): number {
  return (
    plotPadding.left +
    ((value - min) * (chartWidth - plotPadding.left - plotPadding.right)) / (max - min)
  );
}

export function scaleY(value: number, min: number, max: number): number {
  return (
    chartHeight -
    padding.bottom -
    ((value - min) * (chartHeight - padding.top - padding.bottom)) / (max - min)
  );
}

export interface IckbWorthSample {
  readonly date: Date;
  readonly value: number;
}

export type IckbWorthSamples = [IckbWorthSample, IckbWorthSample, ...IckbWorthSample[]];

const sampleCount = 36;
const millisecondsPerYear = 365 * 24 * 60 * 60 * 1000;
const genesisTotalIssuance = 33600000000;
const initialPrimaryAnnualIssuance = 4200000000;
const secondaryAnnualIssuance = 1344000000;
const primaryHalvingYears = 4;
const standardDepositOccupiedCapacityPerIckb = 82 / 100000;
const chainGenesis: Record<RootConfig["chain"], number> = {
  mainnet: Date.parse("2019-11-15T21:09:50.812Z"),
  testnet: Date.parse("2020-05-12T09:37:10Z"),
};

/**
 * Builds chart samples for the selected conversion direction.
 *
 * @remarks CKB-to-iCKB samples invert the estimated iCKB worth so both directions can share the same source approximation.
 */
export function conversionWorthSamples(
  chain: RootConfig["chain"],
  isCkb2Udt: boolean,
  quoteState: QuoteState | undefined,
): IckbWorthSamples {
  const [first, second, ...rest] = ickbWorthSamples(chain, quoteState);
  const convert = ({ date, value }: IckbWorthSample): IckbWorthSample => ({
    date,
    value: isCkb2Udt ? 1 / value : value,
  });
  return [convert(first), convert(second), ...rest.map(convert)];
}

/**
 * Builds approximate historical iCKB worth samples from chain genesis to the current tip or clock time.
 *
 * @remarks The curve is the DAO rate alone, one to one at genesis: the live exchange ratio is gross of the standard deposit's occupied capacity, so the final sample, the live tip when quote state is available, has that constant taken back out.
 */
export function ickbWorthSamples(
  chain: RootConfig["chain"],
  quoteState: QuoteState | undefined,
): IckbWorthSamples {
  const genesis = chainGenesis[chain];
  const liveTip = liveTipSample(quoteState);
  const end = Math.max(genesis, liveTip?.date.getTime() ?? Date.now());
  const sampleAt = (index: number): IckbWorthSample => {
    const date = new Date(genesis + ((end - genesis) * index) / (sampleCount - 1));
    return {
      date,
      value: ickbWorthAt(date, chain),
    };
  };
  const samples: IckbWorthSamples = [
    sampleAt(0),
    sampleAt(1),
    ...Array.from({ length: sampleCount - 2 }, (_, index) => sampleAt(index + 2)),
  ];

  if (liveTip !== undefined) {
    // Anchor the approximation to the observed exchange ratio, net of the occupied capacity.
    samples[samples.length - 1] = liveTip;
  }

  return samples;
}

/**
 * Approximates iCKB worth at a point in time from issuance schedule constants.
 */
export function ickbWorthAt(date: Date, chain: RootConfig["chain"]): number {
  const elapsedYears = Math.max(
    0,
    (date.getTime() - chainGenesis[chain]) / millisecondsPerYear,
  );
  return accumulatedDaoRate(elapsedYears);
}

function liveTipSample(quoteState: QuoteState | undefined): IckbWorthSample | undefined {
  if (quoteState === undefined) {
    return undefined;
  }

  const timestamp = Number(quoteState.tipTimestamp);
  // The ratio counts the standard deposit's occupied capacity a redeemer gets back; the
  // curve does not, so genesis reads one to one.
  const value =
    Number(quoteState.exchangeRatio.udtScale) /
      Number(quoteState.exchangeRatio.ckbScale) -
    standardDepositOccupiedCapacityPerIckb;
  if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
    return undefined;
  }

  return {
    date: new Date(timestamp),
    value,
  };
}

function accumulatedDaoRate(elapsedYears: number): number {
  let remainingYears = elapsedYears;
  let totalIssuance = genesisTotalIssuance;
  let accumulatedRate = 1;
  let primaryAnnualIssuance = initialPrimaryAnnualIssuance;

  while (remainingYears > 0) {
    const years = Math.min(remainingYears, primaryHalvingYears);
    const annualIssuance = primaryAnnualIssuance + secondaryAnnualIssuance;
    accumulatedRate *=
      ((totalIssuance + annualIssuance * years) / totalIssuance) **
      (secondaryAnnualIssuance / annualIssuance);
    totalIssuance += annualIssuance * years;
    primaryAnnualIssuance /= 2;
    remainingYears -= years;
  }

  return accumulatedRate;
}

export function valueGridMarks(
  minY: number,
  maxY: number,
  unit: string,
  amount: bigint,
): Array<{ readonly value: number; readonly label: string }> {
  const marks = [minY, (minY + maxY) / 2, maxY]
    .filter(
      (value, index, values) =>
        value >= minY &&
        value <= maxY &&
        values.findIndex((other) => Math.abs(other - value) < 0.005) === index,
    )
    .map((value) => ({
      value,
      label: `${compactText(amount, value)} ${unit}`,
    }));

  return marks.filter(
    ({ label }, index) => marks.findIndex((mark) => mark.label === label) === index,
  );
}

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
