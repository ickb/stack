import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversionWorthSamples,
  ickbWorthAt,
  ickbWorthSamples,
  rateChartView,
} from "../../src/chart/model.ts";
import { compactText } from "../../src/shared/figures.ts";

const sampledMainnetTipDate = new Date("2026-06-07T18:43:08.091Z");
const sampledMainnetTipDaoRate = 1.19704741;
const liveTipDateIso = "2026-06-10T00:00:00.000Z";
const oneIckbWorthTitle = "1 iCKB worth over time";

// Without a live tip the curve ends at the clock, so the clock is pinned.
beforeEach(() => {
  vi.useFakeTimers({ now: sampledMainnetTipDate });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ickbWorthSamples", () => {
  it("starts one to one at genesis", () => {
    const samples = ickbWorthSamples("mainnet", undefined);

    expect(samples[0]).toEqual({
      date: new Date("2019-11-15T21:09:50.812Z"),
      value: 1,
    });
  });

  it("uses the Testnet genesis timestamp", () => {
    expect(ickbWorthSamples("testnet", undefined)[0].date).toEqual(
      new Date("2020-05-12T09:37:10Z"),
    );
  });

  it("stays close to sampled mainnet DAO history", () => {
    expect(
      Math.abs(ickbWorthAt(sampledMainnetTipDate, "mainnet") - sampledMainnetTipDaoRate),
    ).toBeLessThan(0.0005);
  });

  it("uses the live tip as the endpoint when available", () => {
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const samples = ickbWorthSamples("testnet", {
      exchangeRatio: { ckbScale: 100000n, udtScale: 125082n },
      tipTimestamp: BigInt(Date.parse(liveTipDateIso)),
    });
    const tip = samples.at(-1);

    expect(tip?.date).toEqual(new Date(liveTipDateIso));
    // The live ratio is gross of the deposit's occupied capacity; the curve is not.
    expect(tip?.value).toBeCloseTo(1.25, 10);
  });

  it("ignores invalid live tip values", () => {
    const samples = ickbWorthSamples("testnet", {
      exchangeRatio: { ckbScale: 0n, udtScale: 1n },
      tipTimestamp: 1n,
    });

    expect(samples.at(-1)?.value).not.toBe(Infinity);
  });

  it("inverts the curve for CKB to iCKB direction", () => {
    const samples = conversionWorthSamples("mainnet", true, {
      exchangeRatio: { ckbScale: 100000n, udtScale: 125082n },
      tipTimestamp: BigInt(Date.parse(liveTipDateIso)),
    });
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

  it("keeps the caption amount in the ticks' compact style", () => {
    expect(view(12200000000n, false).title).toBe("122 iCKB worth over time:");
    expect(view(1233400000n, false).title).toBe("12.3 iCKB worth over time:");
    expect(view(100000000000n, false).title).toBe("1K iCKB worth over time:");
    expect(view(123456789000000n, false).title).toBe("1.23M iCKB worth over time:");
    expect(view(123456789n, false).title).toBe("1.23 iCKB worth over time:");
    expect(view(100000000n, true).description).toContain("0.84 iCKB");
    expect(view(100000000n, true).description).not.toContain("0.835");
  });

  it("uses 1 as the minimum chart amount", () => {
    const state = view(1n, false);

    expect(state.title).toBe(`${oneIckbWorthTitle}:`);
    expect(state.gridMarks.map(({ label }) => label)).toContain("1 CKB");
  });

  it("clamps huge amounts and formats them compactly", () => {
    const state = view(10n ** 120n, false);

    expect(state.title).toBe("184B iCKB worth over time:");
    expect(state.title).not.toContain("Infinity");
  });

  it("names the chain in the description", () => {
    expect(view(100000000n, false).description).toContain(
      "Protocol-derived Mainnet curve",
    );
    expect(
      rateChartView({ amount: 100000000n, chain: "testnet", isCkb2Udt: false })
        .description,
    ).toContain("Protocol-derived Testnet curve");
  });

  it("labels a flat curve once", () => {
    // A day after testnet genesis the rate has not moved past the labels' rounding.
    vi.setSystemTime(new Date("2020-05-13T09:37:10Z"));

    expect(
      rateChartView({ amount: 100000000n, chain: "testnet", isCkb2Udt: false }).gridMarks,
    ).toMatchObject([{ label: "1 CKB" }]);
  });

  it("describes the visible direction", () => {
    expect(view(100000000n, true).caption).toBe(
      "iCKB earns NervosDAO compensation, so 1 CKB buys a little less iCKB every day.",
    );
    expect(view(100000000n, false).caption).toBe(
      "iCKB earns NervosDAO compensation, so 1 iCKB is worth a little more CKB every day.",
    );
  });

  it("builds stable chart geometry", () => {
    const state = view(100000000n, false);

    const points = state.points.split(" ");
    expect(points).toHaveLength(36);
    // The curve spans the plot: genesis at the bottom left, the tip at the top right.
    expect([points[0], points.at(-1)]).toEqual(["10,98", "606,18"]);
    expect(state.gridMarks.map(({ label }) => label)).toEqual([
      "1 CKB",
      "1.1 CKB",
      "1.2 CKB",
    ]);
    expect(state.tip.date).toEqual(sampledMainnetTipDate);
    expect(state.maxX).toBeGreaterThan(state.minX);
    expect(state.maxY).toBeGreaterThan(state.minY);
  });
});

describe("compactText", () => {
  it("formats large graph labels with compact units", () => {
    expect(compactText(100000000000000000n, 10)).toBe("10B");
    expect(compactText(1_000_000_000_000_000n, 1)).toBe("10M");
    expect(compactText(1_000_000_000_000n, 1)).toBe("10K");
    expect(compactText(120_000_000_000n, 1)).toBe("1.2K");
    expect(compactText(999_500_000_000n, 1)).toBe("10K");
  });

  it("formats deduplicated grid labels without suffixes", () => {
    expect(view(123400000n, false).gridMarks.map(({ label }) => label)).toContain(
      "1.23 CKB",
    );
  });
});

function view(amount: bigint, isCkb2Udt: boolean): ReturnType<typeof rateChartView> {
  return rateChartView({
    amount,
    chain: "mainnet",
    isCkb2Udt,
  });
}
