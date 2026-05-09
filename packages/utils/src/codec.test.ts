import { describe, expect, it } from "vitest";
import { CheckedInt32LE } from "./codec.js";

describe("CheckedInt32LE", () => {
  it("decodes from the provided byte view offset", () => {
    const backing = new Uint8Array(8);
    backing.set([0xaa, 0xbb, 0xcc, 0xdd], 0);
    backing.set(CheckedInt32LE.encode(1), 4);

    expect(CheckedInt32LE.decode(backing.subarray(4, 8))).toBe(1);
  });
});
