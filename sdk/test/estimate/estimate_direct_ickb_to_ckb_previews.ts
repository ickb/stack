import { afterEach, describe, expect, it, vi } from "vitest";
import { estimate, estimateIckbToCkbOrder } from "../../src/conversion/sdk_estimate.ts";
import { quoteConversion, Ratio } from "../../src/order/index.ts";
import { system } from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE } from "./support/estimate_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(ESTIMATE_SUITE, () => {
  it("uses quote-preserving Uint64 ratio encoding for direct iCKB-to-CKB previews", () => {
    const maxUint64 = (1n << 64n) - 1n;
    const exchangeRatio = Ratio.from({
      ckbScale: maxUint64,
      udtScale: maxUint64 - 2n,
    });
    const amounts = { ckbValue: 0n, udtValue: 1000000n };

    expect(
      quoteConversion(false, exchangeRatio, amounts, {
        fee: 1n,
        feeBase: 100000n,
      }).convertedAmount,
    ).toBe(999990n);

    const result = estimate(
      false,
      amounts,
      system({
        exchangeRatio,
        ckbAvailable: 1000000n,
      }),
    );

    expect(result.convertedAmount).toBe(999900n);
    expect(result.ckbFee).toBe(99n);
    expect(result.info.udtToCkb.ckbScale).toBeLessThanOrEqual(maxUint64);
    expect(result.info.udtToCkb.udtScale).toBeLessThanOrEqual(maxUint64);
  });

  it("builds normal iCKB-to-CKB orders when maturity is unavailable", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1000000n },
      system({ ckbAvailable: 0n }),
    );

    if (result === undefined) {
      throw new Error("Expected iCKB-to-CKB order estimate");
    }
    expect(result.maturity).toBeUndefined();
    expect(result.notice).toEqual({
      kind: "maturity-unavailable",
      inputIckb: 1000000n,
      outputCkb: 999900n,
      incentiveCkb: 100n,
      maturityEstimateUnavailable: true,
    });
    expect(result.estimate.info.ckbMinMatchLog).toBe(33);
  });
});
