import { ccc, mol } from "@ckb-ccc/core";
import { CheckedInt32LE } from "@ickb/utils";
import { isValidEntity } from "./entity_validity.ts";

const minInt32 = -(1n << 31n);
const maxInt32 = (1n << 31n) - 1n;

/**
 * Wire shape for a relative master pointer.
 *
 * @public
 */
export interface RelativeLike {
  /** Must be the 32-byte zero padding used by the standard encoding. */
  padding: ccc.BytesLike;
  /** Signed output-index distance from the current order to its master. */
  distance: ccc.NumLike;
}

const RelativeCodec = mol.struct({
  padding: mol.Byte32,
  distance: CheckedInt32LE,
});

const RelativeBase = ccc.Entity.Base<RelativeLike, Relative>();

/**
 * Relative pointer from an order output to its master output.
 *
 * @public
 */
export interface Relative {
  /** Standard zero padding. */
  padding: ccc.Bytes;
  /** Signed output-index distance to the master output. */
  distance: ccc.Num;
  /** Creates a copy of this relative pointer. */
  clone(): Relative;
  /** Returns whether another value has the same padding and distance. */
  eq(other: RelativeLike): boolean;
  /** Returns the CKB hash of the serialized relative pointer. */
  hash(): ccc.Hex;
  /** Returns whether padding is canonical and distance fits Int32. */
  isValid(): boolean;
  /** Serializes the relative pointer to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the relative pointer to full-width hexadecimal. */
  toHex(): ccc.Hex;
  /** Throws unless padding is canonical and distance fits Int32. */
  validate(): void;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const RelativeImplementation = class Relative extends RelativeBase {
  static {
    ccc.codec(RelativeCodec)(this);
  }

  /** Standard zero padding. */
  public padding: ccc.Bytes;
  /** Signed output-index distance to the master output. */
  public distance: ccc.Num;

  /** Creates a normalized relative pointer. */
  constructor(padding: ccc.Bytes, distance: ccc.Num) {
    super();
    this.padding = padding;
    this.distance = distance;
  }

  /** Normalizes a relative pointer wire object or existing entity into `Relative`. */
  public static override from(relative: RelativeLike): Relative {
    if (relative instanceof Relative) {
      return relative;
    }

    const { padding, distance } = relative;
    return new Relative(ccc.bytesFrom(padding), ccc.numFrom(distance));
  }

  /** Creates a relative pointer with standard zero padding. */
  public static create(distance: ccc.Num): Relative {
    return new Relative(Relative.padding(), distance);
  }

  /** Returns the standard 32-byte zero padding. */
  public static padding(): ccc.Bytes {
    return new Uint8Array(32);
  }

  /** Throws when padding is not the standard 32-byte zero value. */
  public validate(): void {
    if (this.padding.length !== 32 || this.padding.some((x) => x !== 0)) {
      throw new Error("Relative master invalid, non standard padding");
    }
    if (this.distance < minInt32 || this.distance > maxInt32) {
      throw new Error("Relative master distance exceeds Int32");
    }
  }

  /** Returns true when validation succeeds. */
  public isValid(): boolean {
    return isValidEntity(this);
  }
};

/** CCC-backed relative-pointer constructor and codec. @public */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const Relative: {
  byteLength?: number;
  new (padding: ccc.Bytes, distance: ccc.Num): Relative;
  create: (distance: ccc.Num) => Relative;
  decode: (encoded: ccc.BytesLike) => Relative;
  encode: (relative: RelativeLike) => ccc.Bytes;
  from: (relative: RelativeLike) => Relative;
  fromBytes: (encoded: ccc.BytesLike) => Relative;
  padding: () => ccc.Bytes;
} = RelativeImplementation;
