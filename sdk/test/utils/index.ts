import { describe, expect, it } from "vitest";
import * as utils from "../../src/utils/index.ts";

describe("utils package barrel", () => {
  it("exposes runtime behavior through the barrel", async () => {
    expect(utils.CheckedInt32LE.decode(utils.CheckedInt32LE.encode(-42))).toBe(-42);
    expect(utils.CheckedUint128LE.decode(utils.CheckedUint128LE.encode(42n))).toBe(42n);
    await expect(
      utils.asyncBinarySearch(6, async (index) => {
        await Promise.resolve();
        return index >= 5;
      }),
    ).resolves.toBe(5);
  });
});
