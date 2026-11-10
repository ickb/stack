import { describe, expect, it } from "vitest";
import {
  OrderConversionRepresentabilityError,
  quoteConversion,
} from "../../src/order/conversion.ts";

describe("order conversion and I/O", () => {
  it("rejects unrepresentable quotes", () => {
    expect(() => {
      quoteConversion("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, -1n, {
        fee: 0n,
        feeBase: 100000n,
      });
    }).toThrow("Order conversion amounts cannot be negative");
    expect(() => {
      quoteConversion("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, 0n, {
        fee: 0n,
        feeBase: 100000n,
      });
    }).toThrow(OrderConversionRepresentabilityError);
    expect(() => {
      quoteConversion("ckb-to-ickb", { ckbScale: 1n << 80n, udtScale: 1n }, 1n, {
        fee: 0n,
        feeBase: 100000n,
      });
    }).toThrow(OrderConversionRepresentabilityError);
  });

  it("refuses a direction that is neither of the two", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- A plain-JS caller's typo, which TypeScript cannot see.
      quoteConversion(JSON.parse('"sideways"'), { ckbScale: 1n, udtScale: 1n }, 1n),
    ).toThrow(new TypeError("Unknown conversion direction: sideways"));
  });
});
