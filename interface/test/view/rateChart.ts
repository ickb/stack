import { Ratio } from "@ickb/sdk";
import { describe, expect, it } from "vitest";
import {
  conversionWorthSamples,
  ickbWorthAt,
  ickbWorthSamples,
} from "../../src/chart/rateChartData.ts";
import { graphAmountText } from "../../src/chart/rateChartText.ts";
import { rateChartView } from "../../src/chart/rateChartView.ts";

const sampledMainnetTipDate = new Date("2026-06-07T18:43:08.091Z");
const sampledMainnetTipGrossValue = 1.19704741 + 0.00082;
const liveTipDateIso = "2026-06-10T00:00:00.000Z";
const oneIckbWorthTitle = "1 iCKB worth over time";

describe("ickbWorthSamples", () => {
  it("starts with the gross standard-deposit recoverable value", () => {
    const samples = ickbWorthSamples("mainnet", undefined, sampledMainnetTipDate);

    expect(samples[0]).toEqual({
      date: new Date("2019-11-15T21:09:50.812Z"),
      value: 1.00082,
    });
  });

  it("uses the Testnet genesis timestamp", () => {
    expect(ickbWorthSamples("testnet", undefined, sampledMainnetTipDate)[0].date).toEqual(
      new Date("2020-05-12T09:37:10Z"),
    );
  });

  it("stays close to sampled mainnet DAO history", () => {
    expect(
      Math.abs(
        ickbWorthAt(sampledMainnetTipDate, "mainnet") - sampledMainnetTipGrossValue,
      ),
    ).toBeLessThan(0.0005);
  });

  it("uses the live tip as the endpoint when available", () => {
    const samples = ickbWorthSamples(
      "testnet",
      {
        exchangeRatio: Ratio.from({ ckbScale: 100000n, udtScale: 125082n }),
        tipTimestamp: BigInt(Date.parse(liveTipDateIso)),
      },
      new Date("2026-07-01T00:00:00.000Z"),
    );
    const tip = samples.at(-1);

    expect(tip?.date).toEqual(new Date(liveTipDateIso));
    expect(tip?.value).toBeCloseTo(1.25082);
  });

  it("ignores invalid live tip values", () => {
    const samples = ickbWorthSamples(
      "testnet",
      {
        exchangeRatio: Ratio.from({ ckbScale: 0n, udtScale: 1n }),
        tipTimestamp: 1n,
      },
      sampledMainnetTipDate,
    );

    expect(samples.at(-1)?.value).not.toBe(Infinity);
  });

  it("inverts the curve for CKB to iCKB direction", () => {
    const samples = conversionWorthSamples(
      "mainnet",
      true,
      {
        exchangeRatio: Ratio.from({ ckbScale: 100000n, udtScale: 125082n }),
        tipTimestamp: BigInt(Date.parse(liveTipDateIso)),
      },
      sampledMainnetTipDate,
    );
    const tip = samples.reduce((_, sample) => sample);

    expect(samples[0].value).toBeCloseTo(1 / 1.00082);
    expect(tip.value).toBeCloseTo(1 / 1.25082);
  });
});

describe("rateChartView", () => {
  it("charts the active conversion direction", () => {
    expect(view(100000000n, true).title).toBe("1 CKB worth over time:");
    expect(view(100000000n, false).title).toBe(`${oneIckbWorthTitle}:`);
  });

  it("scales the chart title by the selected amount", () => {
    expect(view(250000000n, false).title).toBe("2.5 iCKB worth over time:");
  });

  it("keeps graph amounts to three significant digits", () => {
    expect(view(12200000000n, false).title).toBe("122 iCKB worth over time:");
    expect(view(1233400000n, false).title).toBe("12.3 iCKB worth over time:");
    expect(view(123456789n, false).title).toBe("1.23 iCKB worth over time:");
    expect(view(100000000n, true).description).toContain("0.83 iCKB");
    expect(view(100000000n, true).description).not.toContain("0.835");
  });

  it("uses 1 as the minimum chart amount", () => {
    const state = view(1n, false);

    expect(state.title).toBe(`${oneIckbWorthTitle}:`);
    expect(state.gridMarks.map(({ label }) => label)).toContain("1 CKB");
  });

  it("clamps huge amounts and formats them compactly", () => {
    const state = view(10n ** 120n, false);

    expect(state.title).toBe("184G iCKB worth over time:");
    expect(state.title).not.toContain("Infinity");
  });

  it("describes the visible direction", () => {
    expect(view(100000000n, true).caption).toBe(
      "Gross standard-deposit value follows NervosDAO compensation, so CKB converts to less iCKB over time.",
    );
    expect(view(100000000n, false).caption).toBe(
      "Gross standard-deposit value includes recoverable occupied capacity and grows with NervosDAO compensation.",
    );
  });

  it("builds stable chart geometry", () => {
    const state = view(100000000n, false);

    expect(state.samples).toHaveLength(36);
    expect(state.points.split(" ")).toHaveLength(36);
    expect(state.maxX).toBeGreaterThan(state.minX);
    expect(state.maxY).toBeGreaterThan(state.minY);
  });
});

describe("graphAmountText", () => {
  it("formats large graph labels with compact units", () => {
    expect(graphAmountText(100000000000000000n, 10)).toBe("10.0G");
    expect(graphAmountText(1_000_000_000_000_000n, 1)).toBe("10.0M");
    expect(graphAmountText(1_000_000_000_000n, 1)).toBe("10.0K");
    expect(graphAmountText(100000000n, Infinity)).toBe("184G");
  });

  it("formats deduplicated grid labels without suffixes", () => {
    expect(view(123400000n, false).gridMarks.map(({ label }) => label)).toContain(
      "1.24 CKB",
    );
  });
});

function view(amount: bigint, isCkb2Udt: boolean): ReturnType<typeof rateChartView> {
  return rateChartView({
    amount,
    chain: "mainnet",
    isCkb2Udt,
    now: sampledMainnetTipDate,
  });
}
