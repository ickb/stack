import { ccc, mol } from "@ckb-ccc/core";
import { CheckedUint128LE } from "../utils/codec.ts";
import { Info, type InfoLike } from "./info.ts";
import {
  MasterCodec,
  masterFrom,
  masterValidate,
  type Master,
  type MasterLike,
} from "./master.ts";

const maxUint128 = (1n << 128n) - 1n;

/**
 * Wire shape for order cell data.
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
  udtValue: CheckedUint128LE,
  master: MasterCodec,
  info: Info,
});

const OrderBase = ccc.Entity.Base<OrderDataLike, OrderData>();

/**
 * Serialized order cell payload.
 */
export interface OrderData {
  /** UDT amount held by the order cell. */
  udtValue: ccc.FixedPoint;
  /** Master-cell pointer. */
  master: Master;
  /** Price and minimum-match metadata. */
  info: Info;
  /** Creates a copy of this order payload. */
  clone(): OrderData;
  /** Returns whether another value has the same order payload. */
  eq(other: OrderDataLike): boolean;
  /** Resolves a relative master against `current`, or returns the absolute master. */
  getMaster(current: ccc.OutPoint): ccc.OutPoint;
  /** Returns the CKB hash of the serialized order payload. */
  hash(): ccc.Hex;
  /** Returns whether the master pointer is relative to the current output. */
  isMint(): boolean;
  /** Serializes the order payload to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the order payload to full-width hexadecimal. */
  toHex(): ccc.Hex;
  /** Throws if the UDT value, master pointer, or info is invalid. */
  validate(): void;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const OrderDataImplementation = class OrderData extends OrderBase {
  static {
    ccc.codec(OrderDataCodec)(this);
  }

  /** UDT amount held by the order cell. */
  public readonly udtValue: ccc.FixedPoint;
  /** Master-cell pointer. */
  public readonly master: Master;
  /** Price and minimum-match metadata. */
  public readonly info: Info;

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
    if (this.udtValue < 0n) {
      throw new Error("udtValue invalid, negative");
    }
    if (this.udtValue > maxUint128) {
      throw new Error("udtValue exceeds Uint128");
    }
    masterValidate(this.master);
    this.info.validate();
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
};

/** CCC-backed order-data constructor and codec. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const OrderData: {
  byteLength?: number;
  new (udtValue: ccc.FixedPoint, master: Master, info: Info): OrderData;
  decode: (encoded: ccc.BytesLike) => OrderData;
  encode: (data: OrderDataLike) => ccc.Bytes;
  from: (data: OrderDataLike) => OrderData;
  fromBytes: (encoded: ccc.BytesLike) => OrderData;
} = OrderDataImplementation;
