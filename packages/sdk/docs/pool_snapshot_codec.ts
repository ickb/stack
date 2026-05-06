import { ccc } from "@ckb-ccc/core";

const N = 1024;

/**
 * Archived reference implementation of the older pool snapshot codec.
 *
 * This file is intentionally kept out of the live `@ickb/sdk` runtime surface.
 * It exists as implementation backlog material for future snapshot work.
 * The current stack runtime still uses direct deposit scans because this older
 * shapeless format had no explicit discriminator.
 */
export const PoolSnapshot = ccc.Codec.from<number[]>({
  encode: (bins) => {
    if (bins.length !== N) {
      throw new Error("Expected 1024 bins");
    }

    const bitsPerBin = computeBits(bins);
    const buffer = new Uint8Array((bitsPerBin * N) >> 3);

    let bitOffset = 0;
    for (const count of bins) {
      packBits(buffer, bitOffset, bitsPerBin, count);
      bitOffset += bitsPerBin;
    }
    return buffer;
  },

  decode: (bufferLike) => {
    const buffer = ccc.bytesFrom(bufferLike);
    const bitsPerBin = (buffer.byteLength * 8) / N;
    if (!Number.isInteger(bitsPerBin)) {
      throw new Error("Invalid buffer length for 1024 bins");
    }
    const bins = new Array<number>(N);
    let bitOffset = 0;
    for (let i = 0; i < N; i++) {
      bins[i] = unpackBits(buffer, bitOffset, bitsPerBin);
      bitOffset += bitsPerBin;
    }
    return bins;
  },
});

function computeBits(bins: number[]): number {
  return Math.ceil(Math.log2(1 + Math.max(1, ...bins)));
}

function packBits(
  buffer: Uint8Array,
  bitOffset: number,
  width: number,
  value: number,
): void {
  let offset = bitOffset;
  for (let i = 0; i < width; i++) {
    const byteIndex = offset >> 3;
    const bitInByte = offset % 8;
    const bit = (value >> i) & 1;
    buffer[byteIndex]! |= bit << bitInByte;
    offset++;
  }
}

function unpackBits(
  buffer: Uint8Array,
  bitOffset: number,
  width: number,
): number {
  let value = 0;
  let offset = bitOffset;
  for (let i = 0; i < width; i++) {
    const byteIndex = offset >> 3;
    const bitInByte = offset % 8;
    const bit = (buffer[byteIndex]! >> bitInByte) & 1;
    value |= bit << i;
    offset++;
  }
  return value;
}
