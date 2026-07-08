import { describe, expect, it } from "vitest";
import * as core from "../src/index.ts";

describe("core package barrel", () => {
  it("converts values through the public index", () => {
    const ratio = { ckbScale: 2n, udtScale: 3n };

    expect(core.convert(true, 9n, ratio)).toBe(6n);
    expect(core.convert(false, 6n, ratio)).toBe(9n);
  });
});
