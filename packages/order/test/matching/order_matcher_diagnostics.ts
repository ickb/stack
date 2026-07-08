import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { Info } from "../../src/model/info.ts";
import { OrderManager } from "../../src/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  exhaustiveSequentialBestMatch,
  makeUdtToCkbOrder,
  matchKey,
} from "./support/order_match_helpers.ts";
import { dualInfo, makeOrderCell } from "./support/order_order_helpers.ts";
describe(ORDER_MATCHER_SUITE, () => {
  it("charges one mining fee unit per selected partial", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(60),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 1000n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBe(-ccc.fixedPointFrom(40));
  });

  it("ignores matches whose estimated mining fee exceeds the value gain", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: ccc.fixedPointFrom(1000),
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match).toMatchObject({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: {
        orderCount: 1,
        directions: {
          ckbToUdt: { matchableCount: 0 },
          udtToCkb: { matchableCount: 1 },
        },
        candidates: {
          bestGain: 0n,
          positiveGain: 0,
        },
      },
    });
    expect(match.diagnostics?.candidates.rejected.nonPositiveGain).toBeGreaterThan(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("does not select non-positive candidates after rejecting the empty allowance", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("55"),
        index: 0n,
      },
    });

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: -1n,
        udtValue: ccc.fixedPointFrom(1000),
      },
      {
        ckbScale: 1n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match).toMatchObject({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: {
        candidates: {
          bestGain: 0n,
          positiveGain: 0,
        },
      },
    });
    expect(
      match.diagnostics?.candidates.rejected.insufficientCkbAllowance,
    ).toBeGreaterThan(0);
    expect(match.diagnostics?.candidates.rejected.nonPositiveGain).toBeGreaterThan(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("reports one primary allowance rejection reason per candidate", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: -ccc.fixedPointFrom(1000),
        udtValue: -ccc.fixedPointFrom(1000),
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

    const rejected = match.diagnostics?.candidates.rejected;
    expect(rejected?.insufficientCkbAllowance).toBeGreaterThan(0);
    expect(rejected?.insufficientUdtAllowance).toBe(0);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("does not use the same order cell in both match directions", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: ccc.fixedPointFrom(50),
      info: dualInfo(),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("44"),
        index: 0n,
      },
    });

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(50),
        udtValue: ccc.fixedPointFrom(50),
      },
      {
        ckbScale: 2n,
        udtScale: 1n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials.map((partial) => partial.order.cell.outPoint.toHex())).toEqual([
      order.cell.outPoint.toHex(),
    ]);
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("rejects invalid best-match search parameters", () => {
    const order = makeUdtToCkbOrder();
    const allowance = {
      ckbValue: ccc.fixedPointFrom(50),
      udtValue: ccc.fixedPointFrom(50),
    };

    expect(() =>
      OrderManager.bestMatch(
        [order],
        allowance,
        { ckbScale: 0n, udtScale: 1n },
        { ckbAllowanceStep: ccc.fixedPointFrom(1) },
      ),
    ).toThrow("Exchange rate scales must be positive");
    expect(() =>
      OrderManager.bestMatch(
        [order],
        allowance,
        { ckbScale: 1n, udtScale: 0n },
        { ckbAllowanceStep: ccc.fixedPointFrom(1) },
      ),
    ).toThrow("Exchange rate scales must be positive");
    expect(() =>
      OrderManager.bestMatch(
        [order],
        allowance,
        { ckbScale: 1n, udtScale: 1n },
        { ckbAllowanceStep: 0n },
      ),
    ).toThrow("CKB allowance step must be positive");
    expect(() =>
      OrderManager.bestMatch([order], allowance, { ckbScale: 1n, udtScale: 1n }),
    ).not.toThrow();
  });

  it("uses the largest order size when estimating per-partial mining fees", () => {
    const smallOrder = makeUdtToCkbOrder({
      txHashByte: "40",
      orderTxHashByte: "50",
    });
    const largeOrder = makeUdtToCkbOrder({
      txHashByte: "41",
      orderTxHashByte: "51",
      lockArgs: `0x${"00".repeat(100)}`,
    });
    const allowance = {
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 0n,
    };
    const exchangeRate = { ckbScale: 3n, udtScale: 5n };
    const options = {
      feeRate: 1000n,
      ckbAllowanceStep: ccc.fixedPointFrom(1),
    };

    expect(largeOrder.cell.occupiedSize).toBeGreaterThan(smallOrder.cell.occupiedSize);

    expect(
      matchKey(
        OrderManager.bestMatch(
          [smallOrder, largeOrder],
          allowance,
          exchangeRate,
          options,
        ),
      ),
    ).toEqual(
      matchKey(
        exhaustiveSequentialBestMatch(
          [smallOrder, largeOrder],
          allowance,
          exchangeRate,
          options,
        ),
      ),
    );
  });
});
