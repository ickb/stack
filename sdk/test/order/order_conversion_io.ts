import { describe, expect, it } from "vitest";
import {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "../../src/order/conversion.ts";

describe("order conversion and I/O", () => {
  it("rejects unrepresentable quotes", () => {
    expect(() => {
      quoteConversion(
        true,
        { ckbScale: 1n, udtScale: 1n },
        { ckbValue: -1n, udtValue: 0n },
      );
    }).toThrow("Order conversion amounts cannot be negative");
    expect(() => {
      quoteConversion(
        true,
        { ckbScale: 1n, udtScale: 1n },
        { ckbValue: 0n, udtValue: 0n },
      );
    }).toThrow(OrderConversionRepresentabilityError);
    expect(() => {
      quoteConversion(
        true,
        { ckbScale: 1n << 80n, udtScale: 1n },
        { ckbValue: 1n, udtValue: 0n },
      );
    }).toThrow(OrderConversionRepresentabilityError);
  });
});
