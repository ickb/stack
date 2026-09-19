import { Ratio } from "@ickb/sdk";
import { describe, expect, it } from "vitest";
import { conversionQuote } from "../../src/shared/quote.ts";

const unit = Ratio.from({ ckbScale: 1n, udtScale: 1n });

describe("conversionQuote", () => {
  it("quotes both directions net of the default order fee", () => {
    expect(conversionQuote(true, 200000000n, unit)).toBe(199980000n);
    expect(conversionQuote(false, 200000000n, unit)).toBe(199980000n);
  });

  it("returns undefined instead of throwing when a quote cannot be represented", () => {
    expect(
      conversionQuote(true, 1n, Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n })),
    ).toBeUndefined();
  });

  it("rethrows unexpected quote failures", () => {
    expect(() => {
      conversionQuote(true, 100000000n, Ratio.from({ ckbScale: 0n, udtScale: 1n }));
    }).toThrow("Invalid ExchangeRatio");
  });
});
