import { ccc, mol } from "@ckb-ccc/core";
import { CheckedInt32LE } from "@ickb/utils";
import { isValidEntity } from "./entity_validity.ts";

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

/**
 * CCC entity base for serializing and decoding relative master pointers.
 *
 * @public
 */
export const RelativeBase = ccc.Entity.Base<RelativeLike, Relative>();

/**
 * Relative pointer from an order output to its master output.
 *
 * @public
 */
export class Relative extends RelativeBase {
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
  }

  /** Returns true when validation succeeds. */
  public isValid(): boolean {
    return isValidEntity(this);
  }
}
