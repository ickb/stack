import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateIckbToCkbOrder } from "../../src/conversion/estimate.ts";
import { partialOrderFee } from "../../src/order/fee.ts";
import type { Info } from "../../src/order/info.ts";
import { OrderMatcher } from "../../src/order/matcher.ts";
import { OrderManager } from "../../src/order/order.ts";
import { OrderData } from "../../src/order/order_data.ts";
import { Ratio } from "../../src/order/ratio.ts";
import { resolveOrderGroupFixture } from "../conversion/planning/support/sdk_order_support.ts";
import { projectionReadyDeposit } from "../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import {
  hash,
  headerLike,
  system,
} from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE, estimate } from "./support/estimate_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function orderFromEstimate(
  info: Info | undefined,
  amounts: { ckbValue: bigint; udtValue: bigint },
): ReturnType<typeof resolveOrderGroupFixture> {
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
  const orderCell = ccc.Cell.from({
    outPoint: { txHash: hash("78"), index: 0n },
    cellOutput: {
      capacity: minimalCell.cellOutput.capacity + amounts.ckbValue,
      lock: script("55"),
      type: udtScript,
    },
    outputData,
  });
  const masterCell = ccc.Cell.from({
    outPoint: { txHash: hash("78"), index: 1n },
    cellOutput: { lock: script("11"), type: script("55") },
    outputData: "0x",
  });
  return resolveOrderGroupFixture(new OrderManager(script("55"), [], udtScript), {
    masterCell,
    orderCell,
    originCell: orderCell,
  });
}

const DUST_ICKB_TO_CKB = "dust-ickb-to-ckb";

describe(ESTIMATE_SUITE, () => {
  it("does not advertise one-sat iCKB-to-CKB dust orders below the fee threshold", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({ tip: headerLike(0n, { timestamp: 1234n }) }),
      [],
    );

    expect(result).toBeUndefined();
  });

  it("does not throw when default iCKB-to-CKB fee precision exceeds Uint64", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({
          ckbScale: (1n << 64n) - 1n,
          udtScale: (1n << 64n) - 2n,
        }),
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
      [],
    );

    expect(result).toBeUndefined();
  });

  it("throws a public representability error for unrepresentable direct estimates", () => {
    expect(() =>
      estimate(
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
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({
          ckbScale: (1n << 64n) - 1n,
          udtScale: 1n,
        }),
      }),
      [],
    );

    expect(result).toBeUndefined();
  });

  it("returns no iCKB-to-CKB estimate when both default and dust estimates are missing", () => {
    const result = estimateIckbToCkbOrder({ ckbValue: 0n, udtValue: 0n }, system(), []);

    expect(result).toBeUndefined();
  });
});

describe(`${ESTIMATE_SUITE} dust fallback`, () => {
  it("uses a dust estimate when the default iCKB-to-CKB quote is unrepresentable", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
        feeRate: 0n,
        // At this ratio the bot's deposit is worth no CKB: one pool deposit supplies the one.
        poolDeposits: [projectionReadyDeposit(1n, 0n, { ckbValue: 1n })],
      }),
      [],
    );

    expect(result).toMatchObject({
      maturity: 600000n,
      notice: { kind: DUST_ICKB_TO_CKB, incentiveCkb: 0n },
    });
  });

  it("keeps a base estimate without fee search when fee thresholds are disabled", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({ feeRate: 0n }),
      [],
    );

    expect(result).toMatchObject({
      maturity: 600000n,
    });
    expect(result?.notice).toBeUndefined();
  });

  it("returns no iCKB-to-CKB estimate when the base quote converts to zero", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1n },
      system({
        exchangeRatio: Ratio.from({ ckbScale: 2n, udtScale: 1n }),
      }),
      [],
    );

    expect(result).toBeUndefined();
  });

  it("uses a dust quote when the default quote has no actionable maturity", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 100000n },
      system({
        // The default fee pays 10 here; a threshold of 20 sends the estimate to the dust search.
        feeRate: 2n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
      [],
    );

    expect(result).toMatchObject({
      maturity: 601234n,
      notice: { kind: DUST_ICKB_TO_CKB, maturityEstimateUnavailable: false },
    });
  });

  it("returns no dust estimate when no fee reaches the maturity threshold", () => {
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 2n },
      system({
        feeRate: 1n,
      }),
      [],
    );

    expect(result).toBeUndefined();
  });
});

describe(`${ESTIMATE_SUITE} dust order validity`, () => {
  it("keeps one-sat iCKB-to-CKB dust state-valid but not bot-actionable", async () => {
    const quote = estimate(false, { ckbValue: 0n, udtValue: 1n }, system(), {
      fee: 0n,
    });
    const order = await orderFromEstimate(quote.info, {
      ckbValue: 0n,
      udtValue: 1n,
    });

    const matchingRate = { ckbScale: 1n, udtScale: 2n };
    const fill = OrderMatcher.from(order, false, 0n)?.match(1n);
    if (fill === undefined) {
      throw new Error("expected a fill");
    }

    expect(fill.partials).toHaveLength(1);
    expect(fill.partials[0]).toMatchObject({
      ckbOut: order.order.ckbValue + 1n,
      udtOut: 0n,
    });
    expect(fill.ckbDelta).toBe(-1n);
    expect(fill.udtDelta).toBe(1n);
    // The unit gains one shannon at the rate, which its own fee already consumes.
    expect(
      fill.ckbDelta * matchingRate.ckbScale +
        fill.udtDelta * matchingRate.udtScale -
        partialOrderFee([order], 1n),
    ).toBeLessThanOrEqual(0n);
  });

  it("builds dust iCKB-to-CKB orders with quote-preserving Uint64 encoding", () => {
    const maxUint64 = (1n << 64n) - 1n;
    const exchangeRatio = Ratio.from({
      ckbScale: 10000000000000000n,
      udtScale: 11850413696044750n,
    });
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1000000n },
      system({
        exchangeRatio,
        feeRate: 33222n,
        tip: headerLike(0n, { timestamp: 1234n }),
      }),
      [],
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
    expect(result.ckbFee).toBeGreaterThanOrEqual(332220n);
    expect(result.convertedAmount).toBeGreaterThan(0n);
    expect(result.info.udtToCkb.ckbScale).toBeLessThanOrEqual(maxUint64);
    expect(result.info.udtToCkb.udtScale).toBeLessThanOrEqual(maxUint64);
  });
});
