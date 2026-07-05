/**
 * Creates a 32-byte hex string by repeating one byte.
 *
 * @param hexByte - Exactly two hex characters.
 */
export function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }

  return `0x${hexByte.repeat(32)}`;
}
