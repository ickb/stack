import { ccc } from "@ckb-ccc/core";

/**
 * Codec for little-endian 32-bit signed integers.
 *
 * @remarks
 * The encoder rejects numeric values outside the signed 32-bit range before
 * writing bytes. Decoding reads a signed little-endian integer from the bytes
 * after CCC byte normalization.
 */
export const CheckedInt32LE = ccc.Codec.from<ccc.NumLike, number>({
  byteLength: 4,
  encode: (numLike) => {
    const normalized = normalizeInteger(numLike);
    if (normalized < -2147483648n || normalized > 2147483647n) {
      throw new Error("NumLike out of int32 bounds");
    }
    const num = Number(normalized);
    const encoded = new Uint8Array(4);
    new DataView(encoded.buffer).setInt32(0, num, true);
    return encoded;
  },
  decode: (bytesLike) => {
    const bytes = ccc.bytesFrom(bytesLike);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(
      0,
      true,
    );
  },
});

/** Checked codec for 8-bit unsigned integers. */
export const CheckedUint8 = checkedUintLE(1);

/** Checked codec for little-endian 32-bit unsigned integers. */
export const CheckedUint32LE = checkedUintLE(4);

/** Checked codec for little-endian 64-bit unsigned integers. */
export const CheckedUint64LE = checkedUintLE(8);

/** Checked codec for little-endian 128-bit unsigned integers. */
export const CheckedUint128LE = checkedUintLE(16);

function checkedUintLE(byteLength: number): ccc.Codec<ccc.NumLike, ccc.Num> {
  const bitLength = BigInt(byteLength * 8);
  const max = (1n << bitLength) - 1n;
  return ccc.Codec.from({
    byteLength,
    encode: (numLike: ccc.NumLike) => {
      const num = normalizeInteger(numLike);
      if (num < 0n || num > max) {
        throw new Error(`NumLike out of uint${String(bitLength)} bounds`);
      }
      return ccc.numLeToBytes(num, byteLength);
    },
    decode: ccc.numFromBytes,
  });
}

function normalizeInteger(numLike: ccc.NumLike): ccc.Num {
  if (typeof numLike === "number") {
    if (!Number.isFinite(numLike) || !Number.isInteger(numLike)) {
      throw new TypeError("NumLike must be a finite integer");
    }
    if (!Number.isSafeInteger(numLike)) {
      throw new TypeError("NumLike number must be a safe integer");
    }
  }
  try {
    return ccc.numFrom(numLike);
  } catch {
    throw new TypeError("NumLike must be a finite integer");
  }
}
