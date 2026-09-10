import type { QuoteState } from "../query/queries.ts";
import type { RootConfig } from "../shared/utils.ts";

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
  quoteState: Pick<QuoteState, "exchangeRatio" | "tipTimestamp"> | undefined,
  now: Date,
): IckbWorthSamples {
  const [first, second, ...rest] = ickbWorthSamples(chain, quoteState, now);
  const convert = ({ date, value }: IckbWorthSample): IckbWorthSample => ({
    date,
    value: isCkb2Udt ? 1 / value : value,
  });
  return [convert(first), convert(second), ...rest.map(convert)];
}

/**
 * Builds approximate historical iCKB worth samples from chain genesis to the current tip or clock time.
 *
 * @remarks Historical samples include the standard deposit's gross recoverable occupied capacity; when quote state is available, the final sample uses its live iCKB exchange ratio.
 */
export function ickbWorthSamples(
  chain: RootConfig["chain"],
  quoteState: Pick<QuoteState, "exchangeRatio" | "tipTimestamp"> | undefined,
  now: Date,
): IckbWorthSamples {
  const genesis = chainGenesis[chain];
  const liveTip = liveTipSample(quoteState);
  const end = Math.max(genesis, liveTip?.date.getTime() ?? now.getTime());
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
    // Anchor the approximation to the observed gross exchange ratio.
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
  return accumulatedDaoRate(elapsedYears) + standardDepositOccupiedCapacityPerIckb;
}

function liveTipSample(
  quoteState: Pick<QuoteState, "exchangeRatio" | "tipTimestamp"> | undefined,
): IckbWorthSample | undefined {
  if (quoteState?.tipTimestamp === undefined) {
    return undefined;
  }

  const timestamp = Number(quoteState.tipTimestamp);
  const value =
    Number(quoteState.exchangeRatio.udtScale) / Number(quoteState.exchangeRatio.ckbScale);
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
