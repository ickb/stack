import { ccc } from "@ckb-ccc/core";
import { Ratio } from "@ickb/order";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateMaturityFeeThreshold, IckbSdk } from "../../src/sdk.ts";
import { headerLike, system } from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE } from "./support/estimate_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(ESTIMATE_SUITE, () => {
  it("exposes the fee threshold used for maturity previews", () => {
    expect(estimateMaturityFeeThreshold(system({ feeRate: 7n }))).toBe(70n);
  });

  it("omits maturity below the fee threshold", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100000n },
      system({ ckbAvailable: 100000n }),
    );

    expect(result.convertedAmount).toBe(99999n);
    expect(result.ckbFee).toBe(1n);
    expect(result.maturity).toBeUndefined();
  });

  it("uses the chain tip timestamp for preview maturity", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 1000000n },
      system({
        ckbAvailable: 1000000n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    expect(result.convertedAmount).toBe(999990n);
    expect(result.ckbFee).toBe(10n);
    expect(result.maturity).toBe(601234n);
  });

  it("uses UDT-to-CKB fee units when deciding preview maturity", () => {
    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: 100n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
        ckbAvailable: 100n,
      }),
      { fee: 1n, feeBase: 10n },
    );

    expect(result.convertedAmount).toBe(45n);
    expect(result.ckbFee).toBe(5n);
    expect(result.maturity).toBeUndefined();
  });

  it("uses the fee-adjusted CKB output for UDT-to-CKB maturity", () => {
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 10008200000000000n,
    });

    const result = IckbSdk.estimate(
      false,
      { ckbValue: 0n, udtValue: ccc.fixedPointFrom("100000.001") },
      system({
        exchangeRatio,
        ckbAvailable: ccc.fixedPointFrom(100082),
      }),
    );

    expect(result.convertedAmount).toBeLessThan(ccc.fixedPointFrom(100082));
    expect(result.maturity).toBe(600000n);
  });
});
