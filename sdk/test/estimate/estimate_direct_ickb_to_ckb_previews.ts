import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateIckbToCkbOrder } from "../../src/conversion/estimate.ts";
import { BOT_TURN_MS } from "../../src/conversion/maturity.ts";
import { quoteConversion } from "../../src/order/conversion.ts";
import { CKB_MIN_MATCH_LOG_DEFAULT } from "../../src/order/info.ts";
import { Ratio } from "../../src/order/ratio.ts";
import { headerLike, system } from "../transaction/base/support/sdk_core_support.ts";
import { ESTIMATE_SUITE, estimate, sittingSeller } from "./support/estimate_support.ts";

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
      }),
    );

    expect(result.convertedAmount).toBe(999900n);
    expect(result.ckbFee).toBe(99n);
    expect(result.info.udtToCkb.ckbScale).toBeLessThanOrEqual(maxUint64);
    expect(result.info.udtToCkb.udtScale).toBeLessThanOrEqual(maxUint64);
  });

  it("dates a sell order even with a sitting seller and no pool", () => {
    // A fillable seller left on the book for over a turn: the bot has no CKB to give now,
    // so the order reads the pool's last claim date, here the tip (timestamp zero), plus a turn.
    const result = estimateIckbToCkbOrder(
      { ckbValue: 0n, udtValue: 1000000n },
      system({ orderPool: [sittingSeller(0n)], tip: headerLike(1n) }),
      [],
    );

    expect(result).toMatchObject({
      maturity: BOT_TURN_MS,
      info: { ckbMinMatchLog: CKB_MIN_MATCH_LOG_DEFAULT },
    });
    expect(result?.notice).toBeUndefined();
  });
});
