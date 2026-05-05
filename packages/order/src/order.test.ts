import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { OrderCell } from "./cells.js";
import { Info, OrderData, Ratio } from "./entities.js";
import { OrderManager, OrderMatcher } from "./order.js";

describe("OrderMatcher", () => {
  it("uses udtToCkb scales for UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const matcher = OrderMatcher.from(order, false, 0n);

    expect(matcher).toBeDefined();
    expect(OrderMatcher.from(order, true, 0n)).toBeUndefined();
    expect(matcher?.aScale).toBe(2n);
    expect(matcher?.bScale).toBe(5n);
    expect(matcher?.bMaxMatch).toBeGreaterThan(0n);
  });

  it("lets bestMatch consume UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(200),
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

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeLessThan(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
  });

  it("rejects UDT-to-CKB partials below the converted CKB minimum", () => {
    const order = makeUdtToCkbOrder();
    const matcher = OrderMatcher.from(order, false, 0n);

    const belowMinimum = matcher?.match(1n);
    const atMinimum = matcher?.match(3n);

    expect(belowMinimum?.partials).toHaveLength(0);
    expect(atMinimum?.partials).toHaveLength(1);
    expect(atMinimum?.partials[0]?.ckbOut).toBe(ccc.fixedPointFrom(200) + 3n);
    expect(atMinimum?.partials[0]?.udtOut).toBe(ccc.fixedPointFrom(100) - 7n);
  });
});

function makeUdtToCkbOrder(): OrderCell {
  const orderScript = ccc.Script.from({
    codeHash: hash("11"),
    hashType: "type",
    args: "0x",
  });
  const udtScript = ccc.Script.from({
    codeHash: hash("22"),
    hashType: "type",
    args: "0x",
  });

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: {
        txHash: hash("44"),
        index: 0n,
      },
      cellOutput: {
        capacity: ccc.fixedPointFrom(200),
        lock: orderScript,
        type: udtScript,
      },
      outputData: OrderData.from({
        udtValue: ccc.fixedPointFrom(100),
        master: {
          type: "absolute",
          value: {
            txHash: hash("33"),
            index: 1n,
          },
        },
        info: Info.from({
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.from({
            ckbScale: 5n,
            udtScale: 2n,
          }),
          ckbMinMatchLog: 0,
        }),
      }).toBytes(),
    }),
  );
}

function hash(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}
