import { ccc } from "@ckb-ccc/core";
import { max } from "@ickb/utils";

const N = 1024;

/**
 * Codec for encoding and decoding a pool snapshot.
 *
 * The PoolSnapshotCodec encodes an array of 1024 numbers representing event counts for bins,
 * where the number of bits used per bin is dynamically computed as the ceiling of log2(max + 1)
 * across all bins. The codec provides methods to encode the array into a Uint8Array and decode
 * a Uint8Array back to the original array of numbers.
 *
 * @remarks The total number of bits for encoding all the bins is computed as bitsPerBin * 1024. The codec
 * does not have a fixed byteLength since it depends on the data.
 */
export const PoolSnapshot = ccc.Codec.from<number[]>({
  /**
   * Encodes an array of 1024 bin counts into a Uint8Array.
   *
   * @param bins - An array of 1024 numbers. Each number represents the event count for a bin.
   * @returns A Uint8Array containing the packed bit representation of the bin counts.
   * @throws Error if the input array does not contain exactly 1024 elements.
   */
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

  /**
   * Decodes a buffer into an array of 1024 bin counts.
   *
   * The function automatically computes the number of bits per bin from the buffer length,
   * expecting that the total number of bits in the buffer is a multiple of 1024.
   *
   * @param bufferLike - The input that can be converted into a Uint8Array.
   * @returns An array of 1024 numbers representing the decoded bin counts.
   * @throws Error if the buffer length is invalid (i.e., its total bit count is not divisible by 1024).
   */
  decode: (bufferLike) => {
    const buffer = ccc.bytesFrom(bufferLike);
    // Determine bitsPerBin from the fixed structure (totalBits divided by N).
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
  // Note: The byteLength is not fixed as it depends on the data (i.e., the maximum bin count).
});

/**
 * Computes the minimal number of bits required to represent the maximum number in the bins.
 *
 * Given an array of numbers that represent counts for each bin, this function calculates
 * the number of bits required to represent the maximum bin count. A minimum of 1 bit is
 * always returned.
 *
 * @param bins - An array of numbers, each representing a bin's value.
 * @returns The minimal number of bits required to represent the highest value among the bins.
 */
function computeBits(bins: number[]): number {
  return Math.ceil(Math.log2(1 + max(1, ...bins)));
}

/**
 * Packs a given numeric value into a Uint8Array (bit array) at the specified bit offset and width.
 *
 * The function encodes the given number into the provided buffer, using the specified number of bits (width)
 * starting from the specified bit offset. Each bit of the value is written into the buffer.
 *
 * @param buffer - The Uint8Array into which the value will be packed.
 * @param bitOffset - The starting bit index in the array where the value should be packed.
 * @param width - The number of bits to use for packing the value.
 * @param value - The numeric value to pack.
 */
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    buffer[byteIndex]! |= bit << bitInByte;
    offset++;
  }
}

/**
 * Unpacks a numeric value from a Uint8Array (bit array) starting at a given bit offset with a specified width.
 *
 * The function reads bits from the buffer starting at the bit offset and reconstructs a numeric value
 * using the specified number of bits (width).
 *
 * @param buffer - The Uint8Array from which the value will be unpacked.
 * @param bitOffset - The starting bit index in the buffer.
 * @param width - The number of bits to read for unpacking the value.
 * @returns The numeric value resulting from decoding the specified bits.
 */
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const bit = (buffer[byteIndex]! >> bitInByte) & 1;
    value |= bit << i;
    offset++;
  }
  return value;
}
