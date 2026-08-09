import type { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  CheckedInt32LE,
  CheckedUint128LE,
  CheckedUint32LE,
  CheckedUint64LE,
  CheckedUint8,
} from "../src/codec.ts";

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

const unsignedCodecs: Array<[string, ccc.Codec<ccc.NumLike, ccc.Num>, bigint]> = [
  ["CheckedUint8", CheckedUint8, (1n << 8n) - 1n],
  ["CheckedUint32LE", CheckedUint32LE, (1n << 32n) - 1n],
  ["CheckedUint64LE", CheckedUint64LE, (1n << 64n) - 1n],
  ["CheckedUint128LE", CheckedUint128LE, (1n << 128n) - 1n],
];

describe.each(unsignedCodecs)("%s", (_name, codec, max) => {
  it("round-trips zero and the maximum", () => {
    expect(codec.decode(codec.encode(0n))).toBe(0n);
    expect(codec.decode(codec.encode(max))).toBe(max);
  });

  it("rejects negative values and overflow", () => {
    expect(() => codec.encode(-1n)).toThrow("bounds");
    expect(() => codec.encode(max + 1n)).toThrow("bounds");
  });

  it("rejects values that cannot be normalized as integers", () => {
    for (const value of [1.5, NaN, "not-a-number"]) {
      expect(() => codec.encode(value)).toThrow("NumLike must be a finite integer");
    }
  });
});

describe.each([
  ["CheckedUint64LE", CheckedUint64LE],
  ["CheckedUint128LE", CheckedUint128LE],
] as const)("%s JavaScript number safety", (_name, codec) => {
  it("rejects unsafe numbers without rejecting their exact bigint value", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;

    expect(() => codec.encode(unsafe)).toThrow("NumLike number must be a safe integer");
    expect(codec.decode(codec.encode(BigInt(unsafe)))).toBe(BigInt(unsafe));
  });
});
