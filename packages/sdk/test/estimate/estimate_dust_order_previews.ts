import { ccc } from "@ckb-ccc/core";
import { type Info, OrderCell, OrderData, OrderManager, Ratio } from "@ickb/order";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbSdk } from "../../src/sdk.ts";
import {
  hash,
  headerLike,
  ratio,
  system,
} from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE } from "./support/estimate_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function orderFromEstimate(
  info: Info | undefined,
  amounts: { ckbValue: bigint; udtValue: bigint },
): OrderCell {
  if (info === undefined) {
    throw new Error("Expected order estimate info");
  }
  const udtScript = script("66");
  const outputData = OrderData.from({
    udtValue: amounts.udtValue,
    master: {
      type: "relative",
      value: { distance: 1n, padding: new Uint8Array(32) },
    },
    info,
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    outPoint: { txHash: hash("78"), index: 0n },
    cellOutput: { lock: script("55"), type: udtScript },
    outputData,
  });
  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: { txHash: hash("78"), index: 0n },
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + amounts.ckbValue,
        lock: script("55"),
        type: udtScript,
      },
      outputData,
    }),
  );
}

const DUST_ICKB_TO_CKB = "dust-ickb-to-ckb";

describe(ESTIMATE_SUITE, () => {
  it("does not advertise one-sat iCKB-to-CKB dust orders below the fee threshold", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({ ckbAvailable: 1n, tip: headerLike(0n, { timestamp: 1234n }) }),
    );

    expect(result).toBeUndefined();
  });

  it("does not throw when default iCKB-to-CKB fee precision exceeds Uint64", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({
          ckbScale: (1n << 64n) - 1n,
          udtScale: (1n << 64n) - 2n,
        }),
        ckbAvailable: 1n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    expect(result).toBeUndefined();
  });

  it("throws a public representability error for unrepresentable direct estimates", () => {
    expect(() =>
      IckbSdk.estimate(
        true,
        { ckbValue: 1n << 80n, udtValue: 0n },
        system({
          exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n << 80n }),
        }),
        { fee: 0n },
      ),
    ).toThrow("Order conversion quote cannot be represented as Uint64 ratio");
  });

  it("returns no iCKB-to-CKB estimate when default and dust quotes are unrepresentable", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({
          ckbScale: (1n << 64n) - 1n,
          udtScale: 1n,
        }),
        ckbAvailable: 1n,
      }),
    );

    expect(result).toBeUndefined();
  });

  it("returns no iCKB-to-CKB estimate when both default and dust estimates are missing", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 0n },
      system({ ckbAvailable: 0n }),
    );

    expect(result).toBeUndefined();
  });
});

describe(`${ESTIMATE_SUITE} dust fallback`, () => {
  it("uses a dust estimate when the default iCKB-to-CKB quote is unrepresentable", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
        ckbAvailable: 1n << 80n,
        feeRate: 0n,
      }),
    );

    expect(result).toMatchObject({
      maturity: 600000n,
      notice: { kind: DUST_ICKB_TO_CKB, incentiveCkb: 0n },
    });
  });

  it("keeps a base estimate without fee search when fee thresholds are disabled", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({ ckbAvailable: 1n, feeRate: 0n }),
    );

    expect(result).toMatchObject({
      maturity: 600000n,
    });
    expect(result?.notice).toBeUndefined();
  });

  it("returns no iCKB-to-CKB estimate when the base quote converts to zero", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
        ckbAvailable: 1n,
      }),
    );

    expect(result).toBeUndefined();
  });

  it("uses a dust quote when the default quote has no actionable maturity", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 100000n },
      system({
        ckbAvailable: 100000n,
        feeRate: 1n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    expect(result).toMatchObject({
      maturity: 601234n,
      notice: { kind: DUST_ICKB_TO_CKB, maturityEstimateUnavailable: false },
    });
  });

  it("returns no dust estimate when no fee reaches the maturity threshold", () => {
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 2n },
      system({
        ckbAvailable: 2n,
        feeRate: 1n,
      }),
    );

    expect(result).toBeUndefined();
  });
});

describe(`${ESTIMATE_SUITE} dust order validity`, () => {
  it("keeps one-sat iCKB-to-CKB dust state-valid but not bot-actionable", () => {
    const orderManager = new OrderManager(script("55"), [], script("66"));
    const estimate = IckbSdk.estimate(false, { ckbValue: 0n, udtValue: 1n }, system(), {
      fee: 0n,
    });
    const order = orderFromEstimate(estimate.info, {
      ckbValue: 0n,
      udtValue: 1n,
    });

    const match = orderManager.match(order, false, 1n);
    const botMatch = OrderManager.bestMatch(
      [order],
      { ckbValue: 1n, udtValue: 0n },
      ratio,
      {
        feeRate: 1n,
        ckbAllowanceStep: 1n,
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.partials[0]).toMatchObject({
      ckbOut: order.ckbValue + 1n,
      udtOut: 0n,
    });
    expect(match.ckbDelta).toBe(-1n);
    expect(match.udtDelta).toBe(1n);
    expect(botMatch.partials).toHaveLength(0);
  });

  it("builds dust iCKB-to-CKB orders with quote-preserving Uint64 encoding", () => {
    const maxUint64 = (1n << 64n) - 1n;
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 11850413696044750n,
    });
    const result = IckbSdk.estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1000000n },
      system({
        exchangeRatio,
        ckbAvailable: ccc.fixedPointFrom("3102.81677146"),
        feeRate: 33222n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
    );

    if (result === undefined) {
      throw new Error("Expected dust iCKB-to-CKB order estimate");
    }
    expect(result.maturity).toBe(601234n);
    expect(result.notice).toMatchObject({
      kind: DUST_ICKB_TO_CKB,
      inputIckb: 1000000n,
      maturityEstimateUnavailable: false,
    });
    expect(result.estimate.ckbFee).toBeGreaterThanOrEqual(332220n);
    expect(result.estimate.convertedAmount).toBeGreaterThan(0n);
    expect(result.estimate.info.udtToCkb.ckbScale).toBeLessThanOrEqual(maxUint64);
    expect(result.estimate.info.udtToCkb.udtScale).toBeLessThanOrEqual(maxUint64);
  });
});
