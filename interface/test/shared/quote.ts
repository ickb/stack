import { Ratio } from "@ickb/sdk";
import { describe, expect, it } from "vitest";
import {
  conversionQuote,
  quoteDraft,
  type QuoteStateLike,
} from "../../src/shared/quote.ts";

const decimalValidationError = "Enter a decimal amount with up to 8 decimal places";
describe("quoteDraft", () => {
  it("preserves exact amount text and direction", () => {
    expect(quoteDraft("C1.234567899")).toEqual({
      isCkb2Udt: true,
      amount: undefined,
      validationError: decimalValidationError,
    });
    expect(quoteDraft("I2x.5")).toEqual({
      isCkb2Udt: false,
      amount: undefined,
      validationError: decimalValidationError,
    });
    expect(quoteDraft("C2.5")).toEqual({
      isCkb2Udt: true,
      amount: 250000000n,
      validationError: "",
    });
  });
});

describe("conversionQuote", () => {
  it("estimates CKB to iCKB without wallet-specific state", () => {
    expect(conversionQuote("C2", system())).toMatchObject({
      outputText: "2.00",
    });
  });

  it("estimates iCKB to CKB using quote-preserving Uint64 encoding", () => {
    expect(conversionQuote("I2", system())).toMatchObject({
      outputText: "2.00",
    });
  });

  it("shows unavailable output instead of throwing when a quote cannot be represented", () => {
    expect(
      conversionQuote("C0.00000001", {
        exchangeRatio: Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
      }),
    ).toEqual({ outputText: "..." });
  });

  it("returns validation copy for invalid exact input", () => {
    expect(conversionQuote("C1e2", system())).toEqual({
      outputText: decimalValidationError,
    });
  });

  it("keeps a decimal-point editing intermediate unavailable", () => {
    expect(conversionQuote("C.", system())).toEqual({ outputText: "..." });
  });

  it("rethrows unexpected quote failures", () => {
    expect(() => {
      conversionQuote("C1", {
        exchangeRatio: Ratio.from({ ckbScale: 0n, udtScale: 1n }),
      });
    }).toThrow("Invalid ExchangeRatio");
  });
});

function system(): QuoteStateLike {
  return {
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
  };
}
