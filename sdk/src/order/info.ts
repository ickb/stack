import { ccc, mol } from "@ckb-ccc/core";
import { CheckedUint8, type ExchangeRatio } from "../utils/index.ts";
import { Ratio } from "./ratio.ts";

/**
 * Wire shape for an order's directional ratios and minimum CKB match.
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
  ckbMinMatchLog: CheckedUint8,
});

const InfoBase = ccc.Entity.Base<InfoLike, Info>();

/**
 * Order price and minimum-match metadata.
 *
 * @remarks
 * Exactly one populated ratio describes a directional order. Two populated
 * ratios describe a dual-ratio order. Validation rejects empty/invalid pairs and
 * ratio pairs that allow value extraction.
 */
export interface Info {
  /** Ratio for CKB-to-UDT matching, or empty when unavailable. */
  ckbToUdt: Ratio;
  /** Ratio for UDT-to-CKB matching, or empty when unavailable. */
  udtToCkb: Ratio;
  /** Base-2 exponent for the minimum CKB match amount. */
  ckbMinMatchLog: number;
  /** Creates a copy of this order info. */
  clone(): Info;
  /** Returns whether another value has the same order info. */
  eq(other: InfoLike): boolean;
  /** Returns `2 ** ckbMinMatchLog` as the minimum CKB match amount. */
  getCkbMinMatch(): ccc.FixedPoint;
  /** Returns the CKB hash of the serialized order info. */
  hash(): ccc.Hex;
  /** Returns whether the CKB-to-UDT ratio is populated. */
  isCkb2Udt(): boolean;
  /** Returns whether both directional ratios are populated. */
  isDualRatio(): boolean;
  /** Returns whether the UDT-to-CKB ratio is populated. */
  isUdt2Ckb(): boolean;
  /** Serializes the order info to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the order info to full-width hexadecimal. */
  toHex(): ccc.Hex;
  /** Throws if the ratios or minimum-match exponent are invalid. */
  validate(): void;
}

// 2^36 shannons, about 687 CKB: a fresh remainder of that size clears the bot's ten-fee
// floor 22 times over even at a 100,000 fee rate, so a partial fill never strands a scrap.
// Orders under twice that (about 1,375 CKB, about 1,150 iCKB) are taken whole or left;
// that band must stay under the bot's refill line (`ICKB_REFILL_BELOW`, 2,000 iCKB) so a
// buyer the bot cannot complete always fires the refill deposit: 37 would break it.
export const CKB_MIN_MATCH_LOG_DEFAULT = 36;

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const InfoImplementation = class Info extends InfoBase {
  static {
    ccc.codec(InfoCodec)(this);
  }

  /** Ratio for CKB-to-UDT matching, or empty when unavailable. */
  public readonly ckbToUdt: Ratio;
  /** Ratio for UDT-to-CKB matching, or empty when unavailable. */
  public readonly udtToCkb: Ratio;
  /** Base-2 exponent for the minimum CKB match amount. */
  public readonly ckbMinMatchLog: number;

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

  /** Creates directional order info from one ratio, at the default minimum match. */
  public static create(isCkb2Udt: boolean, ratioLike: ExchangeRatio): Info {
    return Info.from({
      ckbToUdt: isCkb2Udt ? ratioLike : Ratio.empty(),
      udtToCkb: isCkb2Udt ? Ratio.empty() : ratioLike,
      ckbMinMatchLog: CKB_MIN_MATCH_LOG_DEFAULT,
    });
  }

  /** Throws when ratio pairing or minimum-match exponent is invalid. */
  public validate(): void {
    if (!isValidCkbMinMatchLog(this.ckbMinMatchLog)) {
      throw new Error("ckbMinMatchLog invalid");
    }
    this.ckbToUdt.validate();
    this.udtToCkb.validate();

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
};

/** CCC-backed order-info constructor and codec. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const Info: {
  byteLength?: number;
  new (ckbToUdt: Ratio, udtToCkb: Ratio, ckbMinMatchLog: number): Info;
  create: (isCkb2Udt: boolean, ratioLike: ExchangeRatio) => Info;
  decode: (encoded: ccc.BytesLike) => Info;
  encode: (info: InfoLike) => ccc.Bytes;
  from: (info: InfoLike) => Info;
  fromBytes: (encoded: ccc.BytesLike) => Info;
} = InfoImplementation;

function isValidCkbMinMatchLog(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 64;
}
