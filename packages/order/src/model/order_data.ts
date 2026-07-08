import { ccc, mol } from "@ckb-ccc/core";
import { isValidEntity } from "./entity_validity.ts";
import { Info, type InfoLike } from "./info.ts";
import {
  MasterCodec,
  masterFrom,
  masterValidate,
  type Master,
  type MasterLike,
} from "./master.ts";

/**
 * Wire shape for order cell data.
 *
 * @public
 */
export interface OrderDataLike {
  /** UDT amount held by the order cell. */
  udtValue: ccc.FixedPointLike;
  /** Relative or absolute pointer to the master cell. */
  master: MasterLike;
  /** Price and minimum-match metadata. */
  info: InfoLike;
}

const OrderDataCodec = mol.struct({
  udtValue: mol.Uint128,
  master: MasterCodec,
  info: Info,
});

/**
 * CCC entity base for serializing and decoding order cell payloads.
 *
 * @public
 */
export const OrderBase = ccc.Entity.Base<OrderDataLike, OrderData>();

/**
 * Serialized order cell payload.
 *
 * @public
 */
export class OrderData extends OrderBase {
  static {
    ccc.codec(OrderDataCodec)(this);
  }

  /** UDT amount held by the order cell. */
  public udtValue: ccc.FixedPoint;
  /** Master-cell pointer. */
  public master: Master;
  /** Price and minimum-match metadata. */
  public info: Info;

  /** Creates normalized order data. */
  constructor(udtValue: ccc.FixedPoint, master: Master, info: Info) {
    super();
    this.udtValue = udtValue;
    this.master = master;
    this.info = info;
  }

  /** Normalizes an `OrderDataLike` wire object or existing entity into `OrderData`. */
  public static override from(data: OrderDataLike): OrderData {
    if (data instanceof OrderData) {
      return data;
    }

    const { udtValue, master, info } = data;
    return new OrderData(ccc.numFrom(udtValue), masterFrom(master), Info.from(info));
  }

  /** Throws when the order payload is not internally valid. */
  public validate(): void {
    if (this.udtValue < 0) {
      throw new Error("udtValue invalid, negative");
    }
    masterValidate(this.master);
    this.info.validate();
  }

  /** Returns true when validation succeeds. */
  public isValid(): boolean {
    return isValidEntity(this);
  }

  /** Returns true when the master pointer is relative to the current output. */
  public isMint(): boolean {
    return this.master.type === "relative";
  }

  /** Resolves the master out point relative to the current order out point. */
  public getMaster(current: ccc.OutPoint): ccc.OutPoint {
    const { type, value } = this.master;
    return type === "relative"
      ? new ccc.OutPoint(current.txHash, current.index + value.distance)
      : value;
  }
}
