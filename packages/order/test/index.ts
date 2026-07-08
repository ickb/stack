import { describe, expect, it } from "vitest";
import * as order from "../src/index.ts";

describe("order package barrel", () => {
  it("creates order metadata through the public index", () => {
    const ratio = order.Ratio.from({ ckbScale: 2n, udtScale: 3n });
    const info = order.Info.create(true, ratio, 4);

    expect(info.isCkb2Udt()).toBe(true);
    expect(info.ckbToUdt.compare(ratio)).toBe(0);
    expect(info.getCkbMinMatch()).toBe(16n);
  });
});
