import { describe, expect, it } from "vitest";
import {
  estimate,
  estimateIckbToCkbOrder,
  minimumOrderAmount,
} from "../../src/conversion/sdk_estimate.ts";
import { Ratio } from "../../src/order/ratio.ts";
import { system } from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE } from "./support/estimate_support.ts";

describe(`${ESTIMATE_SUITE} minimum order amount`, () => {
  const ratios = [
    Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    Ratio.from({ ckbScale: 10_000_000_000_000_000n, udtScale: 11_920_196_649_757_332n }),
  ];

  it("names the smallest CKB-to-iCKB order the fee threshold accepts", () => {
    for (const feeRate of [1n, 1000n, 33_222n, 99_999n]) {
      for (const exchangeRatio of ratios) {
        const state = system({ feeRate, exchangeRatio });
        const minimum = minimumOrderAmount(true, state);
        const accepted = estimate(true, { ckbValue: minimum, udtValue: 0n }, state);

        expect(typeof accepted.maturity).toBe("bigint");
        expect(
          estimate(true, { ckbValue: minimum / 2n, udtValue: 0n }, state).maturity,
        ).toBeUndefined();
        // Ten mining fees at 0.001%: about a million times the fee rate.
        expect(minimum).toBeGreaterThan(feeRate * 100_000n);
        expect(minimum).toBeLessThan(feeRate * 100_000n + 20_000n);
      }
    }
  });

  it("names the smallest iCKB-to-CKB order the dust path accepts", () => {
    for (const feeRate of [1n, 1000n, 33_222n, 99_999n]) {
      for (const exchangeRatio of ratios) {
        const state = system({ feeRate, exchangeRatio });
        const minimum = minimumOrderAmount(false, state);

        const accepted = estimateIckbToCkbOrder(
          { ckbValue: 0n, udtValue: minimum },
          state,
        );
        expect(accepted?.estimate.ckbFee).toBeGreaterThanOrEqual(0n);
        // Exact: one unit less and the dust search finds no fee that reaches the threshold.
        expect(
          estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: minimum - 1n }, state),
        ).toBeUndefined();
      }
    }
  });
});
