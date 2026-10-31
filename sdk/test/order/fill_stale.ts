import { describe, expect, it } from "vitest";
import type { OrderGroup } from "../../src/order/cells.ts";
import { isStale } from "../../src/order/fill.ts";
import { projectionOrderGroup } from "../conversion/planning/support/sdk_order_support.ts";
import { headerLike } from "../transaction/base/support/sdk_core_support.ts";

describe("isStale", () => {
  it("is thirty days of blocks from the origin, an uncommitted origin being fresh", () => {
    // Thirty days of eight-second blocks are 324,000.
    const tip = headerLike(324_005n);
    const at = (blockNumber?: bigint): OrderGroup =>
      projectionOrderGroup({
        ckbValue: 1n,
        udtValue: 0n,
        isDualRatio: false,
        isMatchable: true,
        ...(blockNumber === undefined ? {} : { blockNumber }),
      });

    expect(isStale(at(5n), tip)).toBe(true);
    expect(isStale(at(6n), tip)).toBe(false);
    expect(isStale(at(), tip)).toBe(false);
  });
});
