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
