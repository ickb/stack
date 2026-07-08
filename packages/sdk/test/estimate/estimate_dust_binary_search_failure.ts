import type * as OrderModule from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { system } from "../transaction/base/support/sdk_core_support.ts";

const ORDER_PACKAGE = "@ickb/order";
const DUST_NOTICE = "dust-ickb-to-ckb";

afterEach(() => {
  vi.doUnmock(ORDER_PACKAGE);
  vi.resetModules();
});

describe("IckbSdk.estimate dust fee search", () => {
  it("uses a dust quote when the default quote is unrepresentable", async () => {
    mockUnrepresentableQuote({ fee: 1n, feeBase: 100000n });

    const { estimateIckbToCkbOrder } = await import("../../src/estimate/sdk_estimate.ts");

    expect(
      estimateIckbToCkbOrder(
        { ckbValue: 0n, udtValue: 10n },
        system({ ckbAvailable: 10n, feeRate: 0n }),
      ),
    ).toMatchObject({
      maturity: 600000n,
      notice: { kind: DUST_NOTICE, incentiveCkb: 0n },
    });
  });

  it("stops when an intermediate dust fee quote is unrepresentable", async () => {
    mockUnrepresentableQuote({ fee: 5n, feeBase: 11n });

    const { estimateIckbToCkbOrder } = await import("../../src/estimate/sdk_estimate.ts");

    expect(
      estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: 10n }, system({ feeRate: 1n })),
    ).toBeUndefined();
  });
});

function mockUnrepresentableQuote(blocked: { fee: bigint; feeBase: bigint }): void {
  vi.resetModules();
  vi.doMock(ORDER_PACKAGE, async (importOriginal) => {
    const actual = await importOriginal<typeof OrderModule>();
    return {
      ...actual,
      OrderManager: class extends actual.OrderManager {
        public static override convert(
          isCkb2Udt: boolean,
          _midpoint: unknown,
          _amounts: unknown,
          options?: { fee?: bigint; feeBase?: bigint },
        ): ReturnType<typeof actual.OrderManager.convert> {
          if (
            !isCkb2Udt &&
            options?.fee === blocked.fee &&
            options.feeBase === blocked.feeBase
          ) {
            throw new actual.OrderConversionRepresentabilityError();
          }

          return {
            convertedAmount: 10n,
            ckbFee: options?.fee ?? 0n,
            info: actual.Info.create(false, { ckbScale: 1n, udtScale: 1n }),
          };
        }
      },
    };
  });
}
