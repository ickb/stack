import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ConversionModule from "../../src/order/conversion.ts";
import { DEFAULT_ORDER_FEE, DEFAULT_ORDER_FEE_BASE } from "../../src/order/conversion.ts";
import { Info } from "../../src/order/info.ts";
import { state } from "../transaction/base/support/sdk_core_support.ts";

const CONVERSION_MODULE = "../../src/order/conversion.ts";
afterEach(() => {
  vi.doUnmock(CONVERSION_MODULE);
  vi.resetModules();
});

describe("estimate dust fee search", () => {
  it("uses a dust quote when the default quote is unrepresentable", async () => {
    mockUnrepresentableQuote({ fee: DEFAULT_ORDER_FEE, feeBase: DEFAULT_ORDER_FEE_BASE });

    const { estimateIckbToCkbOrder } = await import("../../src/conversion/estimate.ts");

    expect(
      estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: 10n }, state({ feeRate: 0n }), []),
    ).toMatchObject({
      maturity: 600000n,
    });
  });

  // The search first quotes the highest fee, ten of eleven, then halves toward the lowest.
  it.each([
    ["the highest", 10n],
    ["an intermediate", 5n],
  ])("stops when %s dust fee quote is unrepresentable", async (_, fee) => {
    mockUnrepresentableQuote({ fee, feeBase: 11n });

    const { estimateIckbToCkbOrder } = await import("../../src/conversion/estimate.ts");

    expect(
      estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: 10n }, state({ feeRate: 1n }), []),
    ).toBeUndefined();
  });
});

function mockUnrepresentableQuote(blocked: { fee: bigint; feeBase: bigint }): void {
  vi.resetModules();
  vi.doMock(CONVERSION_MODULE, async (importOriginal) => {
    const actual = await importOriginal<typeof ConversionModule>();
    return {
      ...actual,
      quoteOrder: (
        direction: string,
        _midpoint: unknown,
        _amount: unknown,
        {
          fee = DEFAULT_ORDER_FEE,
          feeBase = DEFAULT_ORDER_FEE_BASE,
        }: { fee?: bigint; feeBase?: bigint } = {},
      ): ReturnType<typeof actual.quoteOrder> => {
        if (
          direction === "ickb-to-ckb" &&
          fee === blocked.fee &&
          feeBase === blocked.feeBase
        ) {
          return { ok: false, reason: "unrepresentable" };
        }
        return {
          ok: true,
          convertedAmount: 10n,
          // The default fee of a ten-unit order rounds to nothing; the dust search pays its fee.
          ckbFee: feeBase === DEFAULT_ORDER_FEE_BASE ? 0n : fee,
          info: Info.create(false, { ckbScale: 1n, udtScale: 1n }),
        };
      },
    };
  });
}
