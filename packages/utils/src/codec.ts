import { ccc } from "@ckb-ccc/core";

/**
 * Codec for little-endian 32-bit signed integers.
 *
 * @remarks
 * The encoder rejects numeric values outside the signed 32-bit range before
 * writing bytes. Decoding reads a signed little-endian integer from the bytes
 * after CCC byte normalization.
 *
 * @public
 */
export const CheckedInt32LE = ccc.Codec.from<ccc.NumLike, number>({
  byteLength: 4,
  encode: (numLike) => {
    const num = Number(numLike);
    if (!Number.isInteger(num)) {
      throw new TypeError("NumLike must be a finite integer");
    }
    if (num < -2147483648 || num > 2147483647) {
      throw new Error("NumLike out of int32 bounds");
    }
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
