import { describe, expect, it } from "vitest";
import * as order from "../src/index.ts";

describe("order package barrel", () => {
  it("creates order metadata through the public index", () => {
    const ratio: order.Ratio = new order.Ratio(2n, 3n);
    const relative: order.Relative = new order.Relative(order.Relative.padding(), 1n);
    const info: order.Info = new order.Info(ratio, order.Ratio.empty(), 4);
    const data: order.OrderData = new order.OrderData(
      5n,
      { type: "relative", value: relative },
      info,
    );

    expect(info.isCkb2Udt()).toBe(true);
    expect(info.ckbToUdt.compare(ratio)).toBe(0);
    expect(info.getCkbMinMatch()).toBe(16n);
    expect(order.Ratio.fromBytes(order.Ratio.encode(ratio)).clone().eq(ratio)).toBe(true);
    expect(order.Relative.fromBytes(relative.toBytes()).clone().eq(relative)).toBe(true);
    expect(order.Info.decode(order.Info.encode(info)).clone().eq(info)).toBe(true);
    expect(order.OrderData.decode(order.OrderData.encode(data)).clone().eq(data)).toBe(
      true,
    );
    expect([
      order.Ratio.byteLength,
      order.Relative.byteLength,
      order.Info.byteLength,
      order.OrderData.byteLength,
    ]).toEqual([16, 36, 33, 89]);
  });

  it("does not expose entity bases or low-level matching entry points", () => {
    for (const name of [
      "InfoBase",
      "OrderBase",
      "RatioBase",
      "RelativeBase",
      "OrderMatcher",
      "OrderMatchSearchIncompleteError",
    ]) {
      expect(order).not.toHaveProperty(name);
    }
    expect(order.OrderManager).not.toHaveProperty("match");
    expect(order.OrderManager).not.toHaveProperty("sequentialMatcher");
  });
});
