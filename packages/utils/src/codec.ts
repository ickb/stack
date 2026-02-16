import { ccc } from "@ckb-ccc/core";

/**
 * Boundary-checked codec for little-endian 32-bit signed integers.
 */
export const CheckedInt32LE = ccc.Codec.from<ccc.NumLike, number>({
  byteLength: 4,
  encode: (numLike) => {
    const num = Number(numLike);
    if (num < -2147483648 || num > 2147483647) {
      throw Error("NumLike out of int32 bounds");
    }
    const encoded = new Uint8Array(4);
    new DataView(encoded.buffer).setInt32(0, num, true);
    return encoded;
  },
  decode: (bytesLike) => {
    const bytes = ccc.bytesFrom(bytesLike);
    return new DataView(bytes.buffer).getInt32(0, true);
  },
});
