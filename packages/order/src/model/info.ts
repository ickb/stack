import { ccc, mol } from "@ckb-ccc/core";
import type { ExchangeRatio } from "@ickb/utils";
import { isValidEntity } from "./entity_validity.ts";
import { Ratio } from "./ratio.ts";

/**
 * Wire shape for an order's directional ratios and minimum CKB match.
 *
 * @public
 */
export interface InfoLike {
  /** Populated when the order can trade CKB for UDT; empty otherwise. */
  ckbToUdt: ExchangeRatio;
  /** Populated when the order can trade UDT for CKB; empty otherwise. */
  udtToCkb: ExchangeRatio;
  /** Base-2 exponent for the minimum CKB match amount. */
  ckbMinMatchLog: ccc.FixedPointLike;
}

const InfoCodec = mol.struct({
  ckbToUdt: Ratio,
  udtToCkb: Ratio,
  ckbMinMatchLog: mol.Uint8,
});

/**
 * CCC entity base for serializing and decoding order `Info` values.
 *
 * @public
 */
export const InfoBase = ccc.Entity.Base<InfoLike, Info>();

/**
 * Order price and minimum-match metadata.
 *
 * @remarks
 * Exactly one populated ratio describes a directional order. Two populated
 * ratios describe a dual-ratio order. Validation rejects empty/invalid pairs and
 * ratio pairs that allow value extraction.
 *
 * @public
 */
export class Info extends InfoBase {
  static {
    ccc.codec(InfoCodec)(this);
  }

  /** Ratio for CKB-to-UDT matching, or empty when unavailable. */
  public ckbToUdt: Ratio;
  /** Ratio for UDT-to-CKB matching, or empty when unavailable. */
  public udtToCkb: Ratio;
  /** Base-2 exponent for the minimum CKB match amount. */
  public ckbMinMatchLog: number;

  /** Creates order info from normalized ratio objects. */
  constructor(ckbToUdt: Ratio, udtToCkb: Ratio, ckbMinMatchLog: number) {
    super();
    this.ckbToUdt = ckbToUdt;
    this.udtToCkb = udtToCkb;
    this.ckbMinMatchLog = ckbMinMatchLog;
  }

  /** Normalizes an `InfoLike` wire object or existing entity into `Info`. */
  public static override from(info: InfoLike): Info {
    if (info instanceof Info) {
      return info;
    }

    const { ckbToUdt, udtToCkb, ckbMinMatchLog } = info;
    return new Info(Ratio.from(ckbToUdt), Ratio.from(udtToCkb), Number(ckbMinMatchLog));
  }

  /** Creates directional order info from one ratio. */
  public static create(
    isCkb2Udt: boolean,
    ratioLike: ExchangeRatio,
    ckbMinMatchLog = Info.ckbMinMatchLogDefault(),
  ): Info {
    return Info.from({
      ckbToUdt: isCkb2Udt ? ratioLike : Ratio.empty(),
      udtToCkb: isCkb2Udt ? Ratio.empty() : ratioLike,
      ckbMinMatchLog,
    });
  }

  /** Throws when ratio pairing or minimum-match exponent is invalid. */
  public validate(): void {
    if (this.ckbMinMatchLog < 0 || this.ckbMinMatchLog > 64) {
      throw new Error("ckbMinMatchLog invalid");
    }

    if (this.ckbToUdt.isEmpty()) {
      if (this.udtToCkb.isPopulated()) {
        return;
      }
      throw new Error("ckbToUdt is Empty, but udtToCkb is not Populated");
    }

    if (this.udtToCkb.isEmpty()) {
      if (this.ckbToUdt.isPopulated()) {
        return;
      }
      throw new Error("udtToCkb is Empty, but ckbToUdt is not Populated");
    }

    if (!this.ckbToUdt.isPopulated() || !this.udtToCkb.isPopulated()) {
      throw new Error("One ratio is invalid, so not Empty and not Populated");
    }

    if (
      this.ckbToUdt.ckbScale * this.udtToCkb.udtScale <
      this.ckbToUdt.udtScale * this.udtToCkb.ckbScale
    ) {
      throw new Error("udtToCkb and ckbToUdt allow order value to be extracted");
    }
  }

  /** Returns true when validation succeeds. */
  public isValid(): boolean {
    return isValidEntity(this);
  }

  /** Returns the minimum CKB match amount. */
  public getCkbMinMatch(): ccc.FixedPoint {
    return 1n << BigInt(this.ckbMinMatchLog);
  }

  /** Returns true when CKB-to-UDT matching is enabled. */
  public isCkb2Udt(): boolean {
    return this.ckbToUdt.isPopulated();
  }

  /** Returns true when UDT-to-CKB matching is enabled. */
  public isUdt2Ckb(): boolean {
    return this.udtToCkb.isPopulated();
  }

  /** Returns true when both directions are enabled. */
  public isDualRatio(): boolean {
    return this.isCkb2Udt() && this.isUdt2Ckb();
  }

  /** Compares the CKB-to-UDT side against another order info. */
  public ckb2UdtCompare(other: Info): number {
    return this.ckbToUdt.compare(other.ckbToUdt);
  }

  /** Compares the UDT-to-CKB side against another order info. */
  public udt2CkbCompare(other: Info): number {
    return other.udtToCkb.compare(this.udtToCkb);
  }

  /** Returns the default minimum CKB match exponent for newly created orders. */
  public static ckbMinMatchLogDefault(): number {
    return 33;
  }
}
