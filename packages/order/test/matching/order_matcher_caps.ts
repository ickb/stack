import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { OrderManager } from "../../src/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import { makeUdtToCkbOrder } from "./support/order_match_helpers.ts";
describe(ORDER_MATCHER_SUITE, () => {
  it("respects a partial cap when selecting the best match", () => {
    const orders = [
      makeUdtToCkbOrder({
        txHashByte: "10",
        orderTxHashByte: "20",
      }),
      makeUdtToCkbOrder({
        txHashByte: "11",
        orderTxHashByte: "21",
      }),
    ];

    const uncapped = OrderManager.bestMatch(
      orders,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );
    const capped = OrderManager.bestMatch(
      orders,
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
        maxPartials: 1,
      },
    );

    expect(uncapped.partials).toHaveLength(2);
    expect(capped.partials).toHaveLength(1);
    expect(capped.ckbDelta).toBeLessThan(0n);
    expect(capped.udtDelta).toBeGreaterThan(0n);
  });
});
