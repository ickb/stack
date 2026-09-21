import { ccc, mol } from "@ckb-ccc/core";
import { CheckedUint64LE } from "../utils/codec.ts";
import { compareBigInt, type ExchangeRatio } from "../utils/utils.ts";

const maxUint64 = (1n << 64n) - 1n;

const RatioCodec = mol.struct({
  ckbScale: CheckedUint64LE,
  udtScale: CheckedUint64LE,
});

const RatioBase = ccc.Entity.Base<ExchangeRatio, Ratio>();

/**
 * Serialized exchange ratio used by order info.
 *
 * @remarks
 * A ratio is either empty (`0, 0`) or populated with both scales greater than
 * zero. Mixed empty/populated values are invalid.
 */
export interface Ratio extends ExchangeRatio {
  /** Creates a copy of this ratio. */
  clone(): Ratio;
  /** Compares effective CKB-to-UDT prices, returning their numeric ordering. */
  compare(other: Ratio): number;
  /** Converts an amount in the selected direction, rounding up only when requested. */
  convert(isCkb2Udt: boolean, amount: ccc.FixedPoint, mustCeil: boolean): ccc.FixedPoint;
  /** Returns whether another value has the same scales. */
  eq(other: ExchangeRatio): boolean;
  /** Returns the CKB hash of the serialized ratio. */
  hash(): ccc.Hex;
  /** Returns whether both scales are zero. */
  isEmpty(): boolean;
  /** Returns whether both scales are positive. */
  isPopulated(): boolean;
  /** Serializes the ratio to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the ratio to full-width hexadecimal. */
  toHex(): ccc.Hex;
  /** Throws unless both scales fit Uint64 and are both zero or both positive. */
  validate(): void;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const RatioImplementation = class Ratio extends RatioBase {
  static {
    ccc.codec(RatioCodec)(this);
  }

  /** CKB-side scale. */
  public readonly ckbScale: ccc.Num;
  /** UDT-side scale. */
  public readonly udtScale: ccc.Num;

  /** Creates a ratio from raw scales. */
  constructor(ckbScale: ccc.Num, udtScale: ccc.Num) {
    super();
    this.ckbScale = ckbScale;
    this.udtScale = udtScale;
  }

  /** Normalizes an exchange ratio wire object or existing entity into `Ratio`. */
  public static override from(ratio: ExchangeRatio): Ratio {
    if (ratio instanceof Ratio) {
      return ratio;
    }

    const { ckbScale, udtScale } = ratio;
    return new Ratio(ckbScale, udtScale);
  }

  /** Throws when the ratio is neither empty nor fully populated. */
  public validate(): void {
    if (
      this.ckbScale < 0n ||
      this.ckbScale > maxUint64 ||
      this.udtScale < 0n ||
      this.udtScale > maxUint64
    ) {
      throw new Error("Ratio scale exceeds Uint64");
    }
    if (!this.isEmpty() && !this.isPopulated()) {
      throw new Error("Ratio invalid: not empty, not populated");
    }
  }

  /** Returns true for the sentinel empty ratio. */
  public isEmpty(): boolean {
    return this.ckbScale === 0n && this.udtScale === 0n;
  }

  /** Returns true when both scales are positive. */
  public isPopulated(): boolean {
    return this.ckbScale > 0n && this.udtScale > 0n;
  }

  /** Creates the sentinel empty ratio. */
  public static empty(): Ratio {
    return new Ratio(0n, 0n);
  }

  /** Compares two populated ratios by effective CKB-to-UDT price. */
  public compare(other: Ratio): number {
    if (this.udtScale === other.udtScale) {
      return compareBigInt(this.ckbScale, other.ckbScale);
    }

    if (this.ckbScale === other.ckbScale) {
      return compareBigInt(other.udtScale, this.udtScale);
    }

    return compareBigInt(this.ckbScale * other.udtScale, other.ckbScale * this.udtScale);
  }

  /** Converts an amount in the requested direction with optional ceiling. */
  public convert(
    isCkb2Udt: boolean,
    amount: ccc.FixedPoint,
    mustCeil: boolean,
  ): ccc.FixedPoint {
    if (!this.isPopulated()) {
      throw new Error("Invalid midpoint ExchangeRatio");
    }

    if (amount === 0n) {
      return 0n;
    }

    let { ckbScale: aScale, udtScale: bScale } = this;
    if (!isCkb2Udt) {
      [aScale, bScale] = [bScale, aScale];
    }

    return (amount * aScale + (mustCeil ? bScale - 1n : 0n)) / bScale;
  }
};

/** CCC-backed ratio constructor and codec. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const Ratio: {
  byteLength?: number;
  new (ckbScale: ccc.Num, udtScale: ccc.Num): Ratio;
  decode: (encoded: ccc.BytesLike) => Ratio;
  empty: () => Ratio;
  encode: (ratio: ExchangeRatio) => ccc.Bytes;
  from: (ratio: ExchangeRatio) => Ratio;
  fromBytes: (encoded: ccc.BytesLike) => Ratio;
} = RatioImplementation;
