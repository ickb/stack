import { ccc, mol } from "@ckb-ccc/core";
import { compareBigInt, type ExchangeRatio } from "@ickb/utils";
import { isValidEntity } from "./entity_validity.ts";

const maxUint64 = (1n << 64n) - 1n;

const RatioCodec = mol.struct({
  ckbScale: mol.Uint64,
  udtScale: mol.Uint64,
});

/**
 * CCC entity base for serializing and decoding exchange ratio values.
 *
 * @public
 */
export const RatioBase = ccc.Entity.Base<ExchangeRatio, Ratio>();

/**
 * Serialized exchange ratio used by order info.
 *
 * @remarks
 * A ratio is either empty (`0, 0`) or populated with both scales greater than
 * zero. Mixed empty/populated values are invalid.
 *
 * @public
 */
export class Ratio extends RatioBase {
  static {
    ccc.codec(RatioCodec)(this);
  }

  /** CKB-side scale. */
  public ckbScale: ccc.Num;
  /** UDT-side scale. */
  public udtScale: ccc.Num;

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
    if (!this.isEmpty() && !this.isPopulated()) {
      throw new Error("Ratio invalid: not empty, not populated");
    }
  }

  /** Returns true when validation succeeds. */
  public isValid(): boolean {
    return isValidEntity(this);
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

  /** Returns a fee-adjusted ratio for one conversion direction. */
  public applyFee(isCkb2Udt: boolean, fee: ccc.Num, feeBase: ccc.Num): Ratio {
    if (fee >= feeBase) {
      throw new Error("Fee too big relative to feeBase");
    }
    if (fee === 0n) {
      return this;
    }
    const { aScale, bScale } = this.feeAdjustedScales(isCkb2Udt, fee, feeBase);

    if (aScale > maxUint64 || bScale > maxUint64) {
      throw new Error("Ratio scale exceeds Uint64");
    }

    return Ratio.from({
      ckbScale: isCkb2Udt ? aScale : bScale,
      udtScale: isCkb2Udt ? bScale : aScale,
    });
  }

  /** Computes reduced direction-specific scales after applying a fee. */
  public feeAdjustedScales(
    isCkb2Udt: boolean,
    fee: ccc.Num,
    feeBase: ccc.Num,
  ): { aScale: ccc.Num; bScale: ccc.Num } {
    if (fee < 0n) {
      throw new Error("Fee cannot be negative");
    }
    if (feeBase <= 0n) {
      throw new Error("Fee base must be positive");
    }
    if (fee >= feeBase) {
      throw new Error("Fee too big relative to feeBase");
    }
    if (!this.isPopulated()) {
      throw new Error("Invalid ExchangeRatio");
    }

    let { ckbScale: aScale, udtScale: bScale } = this;
    if (!isCkb2Udt) {
      [aScale, bScale] = [bScale, aScale];
    }

    aScale *= feeBase - fee;
    bScale *= feeBase;
    const divisor = ccc.gcd(aScale, bScale);
    return {
      aScale: aScale / divisor,
      bScale: bScale / divisor,
    };
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
}
