import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ORDER_FEE,
  DEFAULT_ORDER_FEE_BASE,
} from "../../src/conversion/estimate.ts";
import type * as ConversionModule from "../../src/order/conversion.ts";
import { Info } from "../../src/order/info.ts";
import { system } from "../transaction/base/support/sdk_core_support.ts";

const CONVERSION_MODULE = "../../src/order/conversion.ts";
const DUST_NOTICE = "dust-ickb-to-ckb";

afterEach(() => {
  vi.doUnmock(CONVERSION_MODULE);
  vi.resetModules();
});

describe("IckbSdk.estimate dust fee search", () => {
  it("uses a dust quote when the default quote is unrepresentable", async () => {
    mockUnrepresentableQuote({ fee: DEFAULT_ORDER_FEE, feeBase: DEFAULT_ORDER_FEE_BASE });

    const { estimateIckbToCkbOrder } = await import("../../src/conversion/estimate.ts");

    expect(
      estimateIckbToCkbOrder(
        { ckbValue: 0n, udtValue: 10n },
        system({ feeRate: 0n }),
        [],
      ),
    ).toMatchObject({
      maturity: 600000n,
      notice: { kind: DUST_NOTICE, incentiveCkb: 0n },
    });
  });

  it("stops when an intermediate dust fee quote is unrepresentable", async () => {
    mockUnrepresentableQuote({ fee: 5n, feeBase: 11n });

    const { estimateIckbToCkbOrder } = await import("../../src/conversion/estimate.ts");

    expect(
      estimateIckbToCkbOrder(
        { ckbValue: 0n, udtValue: 10n },
        system({ feeRate: 1n }),
        [],
      ),
    ).toBeUndefined();
  });
});

function mockUnrepresentableQuote(blocked: { fee: bigint; feeBase: bigint }): void {
  vi.resetModules();
  vi.doMock(CONVERSION_MODULE, async (importOriginal) => {
    const actual = await importOriginal<typeof ConversionModule>();
    return {
      ...actual,
      quoteConversion: (
        isCkb2Udt: boolean,
        _midpoint: unknown,
        _amounts: unknown,
        options?: { fee?: bigint; feeBase?: bigint },
      ): ReturnType<typeof actual.quoteConversion> => {
        if (
          !isCkb2Udt &&
          options?.fee === blocked.fee &&
          options.feeBase === blocked.feeBase
        ) {
          throw new actual.OrderConversionRepresentabilityError();
        }
        return {
          convertedAmount: 10n,
          // The default fee of a ten-unit order rounds to nothing; the dust search pays its fee.
          ckbFee: options?.feeBase === DEFAULT_ORDER_FEE_BASE ? 0n : (options?.fee ?? 0n),
          info: Info.create(false, { ckbScale: 1n, udtScale: 1n }),
        };
      },
    };
  });
}
