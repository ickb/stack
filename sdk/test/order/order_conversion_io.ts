import { describe, expect, it } from "vitest";
import { quoteConversion, quoteOrder } from "../../src/order/conversion.ts";

describe("order conversion and I/O", () => {
  it("refuses a negative amount and reports unrepresentable quotes as values", () => {
    const options = { fee: 0n, feeBase: 100000n };
    const unrepresentable = { ok: false, reason: "unrepresentable" };

    expect(() => {
      quoteOrder({ ckbScale: 1n, udtScale: 1n }, "ckb-to-ickb", -1n, options);
    }).toThrow("Order conversion amounts cannot be negative");
    // One misuse type with the build's own negative amount.
    expect(() => {
      quoteConversion({ ckbScale: 1n, udtScale: 1n }, "ckb-to-ickb", -1n);
    }).toThrow(RangeError);
    expect(
      quoteOrder({ ckbScale: 1n, udtScale: 1n }, "ckb-to-ickb", 0n, options),
    ).toEqual(unrepresentable);
    expect(
      quoteOrder({ ckbScale: 1n << 80n, udtScale: 1n }, "ckb-to-ickb", 1n, options),
    ).toEqual(unrepresentable);
    expect(quoteConversion({ ckbScale: 1n, udtScale: 1n }, "ckb-to-ickb", 0n)).toEqual(
      unrepresentable,
    );
  });

  it("quotes publicly at the default fee, without the order's info", () => {
    // 0.01% of 100,000 shannons at one to one.
    expect(
      quoteConversion({ ckbScale: 1n, udtScale: 1n }, "ckb-to-ickb", 100000n),
    ).toEqual({ ok: true, convertedAmount: 99990n, ckbFee: 10n });
  });

  it("refuses a direction that is neither of the two", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- A plain-JS caller's typo, which TypeScript cannot see.
      quoteConversion({ ckbScale: 1n, udtScale: 1n }, JSON.parse('"sideways"'), 1n),
    ).toThrow(new TypeError("Unknown conversion direction: sideways"));
  });
});
