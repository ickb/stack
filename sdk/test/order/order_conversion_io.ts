import { describe, expect, it } from "vitest";
import { quoteConversion, quoteOrder } from "../../src/order/conversion.ts";

describe("order conversion and I/O", () => {
  it("refuses a negative amount and reports unrepresentable quotes as values", () => {
    const options = { fee: 0n, feeBase: 100000n };
    const unrepresentable = { ok: false, reason: "unrepresentable" };

    expect(() => {
      quoteOrder("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, -1n, options);
    }).toThrow("Order conversion amounts cannot be negative");
    // One misuse type with the build's own negative amount.
    expect(() => {
      quoteConversion("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, -1n);
    }).toThrow(RangeError);
    expect(
      quoteOrder("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, 0n, options),
    ).toEqual(unrepresentable);
    expect(
      quoteOrder("ckb-to-ickb", { ckbScale: 1n << 80n, udtScale: 1n }, 1n, options),
    ).toEqual(unrepresentable);
    expect(quoteConversion("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, 0n)).toEqual(
      unrepresentable,
    );
  });

  it("quotes publicly at the default fee, without the order's info", () => {
    // 0.01% of 100,000 shannons at one to one.
    expect(
      quoteConversion("ckb-to-ickb", { ckbScale: 1n, udtScale: 1n }, 100000n),
    ).toEqual({ ok: true, convertedAmount: 99990n, ckbFee: 10n });
  });

  it("refuses a direction that is neither of the two", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- A plain-JS caller's typo, which TypeScript cannot see.
      quoteConversion(JSON.parse('"sideways"'), { ckbScale: 1n, udtScale: 1n }, 1n),
    ).toThrow(new TypeError("Unknown conversion direction: sideways"));
  });
});
