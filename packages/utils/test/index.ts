import { describe, expect, it } from "vitest";
import * as utils from "../src/index.ts";

describe("utils package barrel", () => {
  it("exposes runtime behavior through the barrel", async () => {
    expect(utils.CheckedInt32LE.decode(utils.CheckedInt32LE.encode(-42))).toBe(-42);
    expect(utils.binarySearch(6, (index) => index >= 4)).toBe(4);
    await expect(
      utils.asyncBinarySearch(6, async (index) => {
        await Promise.resolve();
        return index >= 5;
      }),
    ).resolves.toBe(5);
  });
});
