import { describe, expect, it } from "vitest";
import { CheckedInt32LE } from "../src/codec.ts";

describe("CheckedInt32LE", () => {
  it("round-trips signed int32 bounds", () => {
    expect(CheckedInt32LE.decode(CheckedInt32LE.encode(2147483647))).toBe(2147483647);
    expect(CheckedInt32LE.decode(CheckedInt32LE.encode(-2147483648))).toBe(-2147483648);
  });

  it("rejects values outside signed int32 bounds", () => {
    expect(() => CheckedInt32LE.encode(2147483648)).toThrow(
      "NumLike out of int32 bounds",
    );
    expect(() => CheckedInt32LE.encode(-2147483649)).toThrow(
      "NumLike out of int32 bounds",
    );
  });

  it("rejects non-finite and fractional values", () => {
    for (const value of [NaN, Infinity, -Infinity, 1.5]) {
      expect(() => CheckedInt32LE.encode(value)).toThrow(
        "NumLike must be a finite integer",
      );
    }
  });

  it("decodes from the provided byte view offset", () => {
    const backing = new Uint8Array(8);
    backing.set([0xaa, 0xbb, 0xcc, 0xdd], 0);
    backing.set(CheckedInt32LE.encode(1), 4);

    expect(CheckedInt32LE.decode(backing.subarray(4, 8))).toBe(1);
  });
});
