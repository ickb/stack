import { ccc } from "@ckb-ccc/core";
import { Info } from "@ickb/order";
import { describe, expect, it } from "vitest";
import { estimateConversionOrder } from "../../src/estimate/sdk_estimate.ts";
import { maturity } from "../../src/estimate/sdk_maturity.ts";
import { ringTargetSegmentIndex } from "../../src/withdrawal/withdrawal_selection.ts";
import { projectionOrderGroup } from "../conversion/planning/support/sdk_order_support.ts";
import { headerLike, ratio } from "../transaction/base/support/sdk_core_support.ts";

describe("sdk maturity and withdrawal guard helpers", () => {
  it("covers maturity and estimate helper guard branches", () => {
    const highFeeSystem = {
      feeRate: 1n,
      tip: headerLike(0n, { timestamp: 100n }),
      exchangeRatio: ratio,
      orderPool: [
        projectionOrderGroup({
          ckbValue: 10n,
          udtValue: 0n,
          isDualRatio: false,
          isMatchable: true,
        }).order,
      ],
      ckbAvailable: 0n,
      ckbMaturing: [{ ckbCumulative: 100n, maturity: 500n }],
    };

    expect(
      maturity(
        {
          info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
          amounts: { ckbValue: 0n, udtValue: 0n },
        },
        highFeeSystem,
      ),
    ).toBe(0n);
    expect(
      maturity(
        {
          info: Info.create(false, { ckbScale: 1n, udtScale: 1n }),
          amounts: { ckbValue: -50n, udtValue: 10n },
        },
        highFeeSystem,
      ),
    ).toBe(500n);
    expect(
      maturity(
        {
          info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
          amounts: { ckbValue: 10n, udtValue: 0n },
        },
        highFeeSystem,
      ),
    ).toBe(600100n);
    expect(
      estimateConversionOrder(
        true,
        { ckbValue: 0n, udtValue: 0n },
        highFeeSystem,
        0n,
        100000n,
      ),
    ).toBeUndefined();
    expect(() =>
      estimateConversionOrder(
        true,
        { ckbValue: -1n, udtValue: 0n },
        highFeeSystem,
        0n,
        100000n,
      ),
    ).toThrow("Order conversion amounts cannot be negative");
  });

  it("rejects invalid ring target epochs", () => {
    expect(() =>
      ringTargetSegmentIndex(
        headerLike(0n, {
          epoch: ccc.Epoch.from({ integer: 0n, numerator: 0n, denominator: 0n }),
        }),
        1,
      ),
    ).toThrow("Epoch denominator must be positive");
  });
});
