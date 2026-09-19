import { describe, expect, it } from "vitest";
import { quoteConversion } from "../../src/order/conversion.ts";
import { Ratio } from "../../src/order/ratio.ts";

const FEE_TOO_BIG = "Fee too big relative to feeBase";

describe("Ratio", () => {
  it("compares ratios exactly beyond Number precision", () => {
    const scale = 2n ** 60n;
    const larger = Ratio.from({ ckbScale: scale + 1n, udtScale: scale });
    const smaller = Ratio.from({ ckbScale: scale, udtScale: scale });

    expect(Number((scale + 1n) * scale - scale * scale)).toBe(Number(scale));
    expect(larger.compare(smaller)).toBe(1);
    expect(smaller.compare(larger)).toBe(-1);
  });

  it("rejects a fee-bearing quote on an empty ratio", () => {
    expect(() =>
      quoteConversion(true, Ratio.empty(), { ckbValue: 1n, udtValue: 0n }, { fee: 1n }),
    ).toThrow("Invalid ExchangeRatio");
  });

  it("rejects invalid fee policy before conversion", () => {
    const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
    const amounts = { ckbValue: 1n, udtValue: 0n };

    expect(() => quoteConversion(true, ratio, amounts, { fee: 1n, feeBase: 1n })).toThrow(
      FEE_TOO_BIG,
    );
    expect(() => quoteConversion(true, ratio, amounts, { fee: 2n, feeBase: 1n })).toThrow(
      FEE_TOO_BIG,
    );
    expect(() => quoteConversion(true, ratio, amounts, { fee: 0n, feeBase: 0n })).toThrow(
      "Fee base must be positive",
    );
    expect(() =>
      quoteConversion(true, ratio, amounts, { fee: -1n, feeBase: 1n }),
    ).toThrow("Fee cannot be negative");
  });

  it("validates populated and invalid ratios", () => {
    const populated = Ratio.from({ ckbScale: 1n, udtScale: 2n });
    const invalid = Ratio.from({ ckbScale: 1n, udtScale: 0n });

    expect(populated.isValid()).toBe(true);
    expect(invalid.isValid()).toBe(false);
    expect(() => {
      invalid.validate();
    }).toThrow("Ratio invalid");
  });

  it("compares matching CKB scales and converts with direction and ceiling", () => {
    const ratio = Ratio.from({ ckbScale: 2n, udtScale: 3n });

    expect(Ratio.from({ ckbScale: 2n, udtScale: 4n }).compare(ratio)).toBe(-1);
    expect(ratio.compare(Ratio.from({ ckbScale: 2n, udtScale: 4n }))).toBe(1);
    expect(ratio.convert(true, 7n, false)).toBe(4n);
    expect(ratio.convert(true, 7n, true)).toBe(5n);
    expect(ratio.convert(false, 7n, false)).toBe(10n);
    expect(() => Ratio.empty().convert(true, 1n, false)).toThrow(
      "Invalid midpoint ExchangeRatio",
    );
  });

  it("covers zero conversion", () => {
    const ratio = Ratio.from({ ckbScale: 2n, udtScale: 3n });

    expect(ratio.convert(true, 0n, true)).toBe(0n);
    expect(Ratio.from({ ckbScale: 3n, udtScale: 2n }).compare(ratio)).toBe(1);
  });
});
