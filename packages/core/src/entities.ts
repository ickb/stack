import { ccc, mol } from "@ckb-ccc/core";
import { CheckedInt32LE, CheckedUint32LE, CheckedUint64LE } from "@ickb/utils";

/**
 * Represents a permissive data structure of the owner data of the owned owner script.
 *
 * @public
 */
export interface OwnerDataLike {
  /** The signed distance between owner and owned cell in the mint transaction. */
  ownedDistance: ccc.NumLike;
}

const OwnerDataCodec = mol.struct({
  ownedDistance: CheckedInt32LE,
});

const OwnerEntityBase = ccc.Entity.Base<OwnerDataLike, OwnerData>();

/**
 * Encodes the owned-owner marker data that links an owner cell to its owned cell.
 *
 * @public
 */
export interface OwnerData {
  /** Signed output-index distance from the owner marker to the owned cell. */
  ownedDistance: ccc.Num;
  /** Creates a copy of this owner data. */
  clone(): OwnerData;
  /** Returns whether another value has the same owner data. */
  eq(other: OwnerDataLike): boolean;
  /** Returns the CKB hash of the serialized owner data. */
  hash(): ccc.Hex;
  /** Serializes the owner data to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the owner data to full-width hexadecimal. */
  toHex(): ccc.Hex;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const OwnerDataImplementation = class OwnerData extends OwnerEntityBase {
  static {
    ccc.codec(OwnerDataCodec)(this);
  }

  /** Signed output-index distance from the owner marker to the owned cell. */
  public ownedDistance: ccc.Num;

  /**
   * Creates an instance of OwnerData.
   *
   * @param ownedDistance - The signed distance between owner and owned cell in the mint transaction.
   */
  constructor(ownedDistance: ccc.Num) {
    super();
    this.ownedDistance = ownedDistance;
  }

  /**
   * Creates an instance of OwnerData from the provided data.
   *
   * @param data - The data to create the OwnerData instance from.
   * @returns An instance of OwnerData.
   */
  public static override from(data: OwnerDataLike): OwnerData {
    if (data instanceof OwnerData) {
      return data;
    }

    const { ownedDistance } = data;
    return new OwnerData(ccc.numFrom(ownedDistance));
  }

  /**
   * Decodes the fixed owner-data prefix and ignores trailing cell payload bytes.
   *
   * @remarks The owner data prefix is 4 bytes after the `0x` marker: a signed
   * little-endian relative output-index distance to the owned cell. Later bytes
   * belong to other protocol data and are intentionally tolerated here.
   */
  public static decodePrefix(encoded: ccc.Hex): OwnerData {
    return OwnerData.decode(encoded.slice(0, 10));
  }
};

/** CCC-backed owner-data constructor and codec. @public */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const OwnerData: {
  byteLength?: number;
  new (ownedDistance: ccc.Num): OwnerData;
  decode: (encoded: ccc.BytesLike) => OwnerData;
  decodePrefix: (encoded: ccc.Hex) => OwnerData;
  encode: (data: OwnerDataLike) => ccc.Bytes;
  from: (data: OwnerDataLike) => OwnerData;
  fromBytes: (encoded: ccc.BytesLike) => OwnerData;
} = OwnerDataImplementation;

/**
 * Represents a permissive data structure of the data structure for a receipt.
 *
 * @public
 */
export interface ReceiptDataLike {
  /** The quantity of deposits. */
  depositQuantity: ccc.NumLike;
  /** The unoccupied capacity of each deposit tracked by the receipt. */
  depositAmount: ccc.FixedPointLike;
}

const ReceiptDataCodec = mol.struct({
  depositQuantity: CheckedUint32LE,
  depositAmount: CheckedUint64LE,
});

const ReceiptEntityBase = ccc.Entity.Base<ReceiptDataLike, ReceiptData>();

/**
 * Encodes the receipt payload for one or more identical iCKB deposits.
 *
 * @public
 */
export interface ReceiptData {
  /** Number of identical deposits represented by this receipt. */
  depositQuantity: ccc.Num;
  /** Free CKB capacity of each represented deposit before iCKB conversion. */
  depositAmount: ccc.FixedPoint;
  /** Creates a copy of this receipt data. */
  clone(): ReceiptData;
  /** Returns whether another value has the same receipt data. */
  eq(other: ReceiptDataLike): boolean;
  /** Returns the CKB hash of the serialized receipt data. */
  hash(): ccc.Hex;
  /** Serializes the receipt data to bytes. */
  toBytes(): ccc.Bytes;
  /** Serializes the receipt data to full-width hexadecimal. */
  toHex(): ccc.Hex;
}

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const ReceiptDataImplementation = class ReceiptData extends ReceiptEntityBase {
  static {
    ccc.codec(ReceiptDataCodec)(this);
  }

  /** Number of identical deposits represented by this receipt. */
  public depositQuantity: ccc.Num;

  /** Free CKB capacity of each represented deposit before iCKB conversion. */
  public depositAmount: ccc.FixedPoint;

  /**
   * Creates an instance of ReceiptData.
   *
   * @param depositQuantity - The quantity of deposits.
   * @param depositAmount - The unoccupied capacity of each tracked deposit.
   */
  constructor(depositQuantity: ccc.Num, depositAmount: ccc.FixedPoint) {
    super();
    this.depositQuantity = depositQuantity;
    this.depositAmount = depositAmount;
  }

  /**
   * Creates an instance of ReceiptData from the provided data.
   *
   * @param data - The data to create the ReceiptData instance from.
   * @returns An instance of ReceiptData.
   */
  public static override from(data: ReceiptDataLike): ReceiptData {
    if (data instanceof ReceiptData) {
      return data;
    }

    const { depositQuantity, depositAmount } = data;
    return new ReceiptData(
      ccc.numFrom(depositQuantity),
      ccc.fixedPointFrom(depositAmount),
    );
  }

  /**
   * Decodes the fixed receipt-data prefix and ignores trailing cell payload bytes.
   *
   * @remarks The receipt data prefix is 12 bytes after the `0x` marker: 4 bytes
   * for deposit quantity and 8 bytes for deposit amount. Later payload bytes
   * belong to other protocol data and are intentionally tolerated here.
   */
  public static decodePrefix(encoded: ccc.Hex): ReceiptData {
    return ReceiptData.decode(encoded.slice(0, 26));
  }
};

/** CCC-backed receipt-data constructor and codec. @public */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const ReceiptData: {
  byteLength?: number;
  new (depositQuantity: ccc.Num, depositAmount: ccc.FixedPoint): ReceiptData;
  decode: (encoded: ccc.BytesLike) => ReceiptData;
  decodePrefix: (encoded: ccc.Hex) => ReceiptData;
  encode: (data: ReceiptDataLike) => ccc.Bytes;
  from: (data: ReceiptDataLike) => ReceiptData;
  fromBytes: (encoded: ccc.BytesLike) => ReceiptData;
} = ReceiptDataImplementation;
