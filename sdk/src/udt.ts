import { ccc, mol } from "@ckb-ccc/core";
import { isDaoDeposit } from "./dao.ts";
import { CheckedUint128LE, CheckedUint32LE, CheckedUint64LE } from "./utils/codec.ts";
import { transactionHeaders } from "./utils/transaction_header.ts";
import type { ExchangeRatio } from "./utils/utils.ts";

const ickbXudtTypeOccupiedSize = 69;
const udtDataSize = 16;
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ccc.fixedPointFrom(100000);
const xudtOwnerMode = 0x80000000n;

// A receipt's fixed prefix: 4 bytes of deposit quantity and 8 of deposit amount.
export const receiptDataBytes = 12;

/** The receipt payload for one or more identical iCKB deposits. */
export interface ReceiptData {
  /** Number of identical deposits represented by this receipt. */
  depositQuantity: ccc.Num;
  /** Free CKB capacity of each represented deposit before iCKB conversion. */
  depositAmount: ccc.FixedPoint;
}

const ReceiptDataCodec = mol.struct({
  depositQuantity: CheckedUint32LE,
  depositAmount: CheckedUint64LE,
});

/** Encodes a receipt payload. */
export function encodeReceiptData(data: ReceiptData): ccc.Bytes {
  return ReceiptDataCodec.encode(data);
}

/**
 * Decodes the fixed receipt-data prefix and ignores trailing cell payload bytes.
 *
 * @remarks The receipt data prefix is 12 bytes after the `0x` marker: 4 bytes for deposit
 * quantity and 8 bytes for deposit amount. Later payload bytes belong to other protocol
 * data and are intentionally tolerated here.
 */
export function decodeReceiptData(outputData: ccc.Hex): ReceiptData {
  return ReceiptDataCodec.decode(outputData.slice(0, 2 + 2 * receiptDataBytes));
}

/**
 * Soft per-deposit iCKB value cap used before applying the excess discount.
 */
export const ICKB_DEPOSIT_CAP = ccc.fixedPointFrom(100000); // 100,000 iCKB

/**
 * The iCKB xUDT token: its scripts, code cells, and the iCKB accounting of a
 * transaction's inputs. Inputs carry iCKB as xUDT balances, as receipt value,
 * and negatively as the first-phase deposits a transaction re-mints.
 */
export class IckbUdt {
  /** The iCKB xUDT type script. */
  public readonly script: ccc.Script;

  /** Out point of the xUDT code cell used by this iCKB token. */
  public readonly udtCode: ccc.OutPoint;

  /** Out point of the iCKB Logic code cell required by this token. */
  public readonly logicCode: ccc.OutPoint;

  /** Logic script whose hash is embedded in this iCKB xUDT type script. */
  public readonly logicScript: ccc.Script;

  /** The Nervos DAO script, to recognize the first-phase deposits a transaction re-mints. */
  public readonly daoScript: ccc.Script;

  /** Creates an instance of IckbUdt from its code and script references. */
  constructor({
    code,
    script,
    logicCode,
    logicScript,
    daoScript,
  }: {
    code: ccc.OutPointLike;
    script: ccc.ScriptLike;
    logicCode: ccc.OutPointLike;
    logicScript: ccc.ScriptLike;
    daoScript: ccc.ScriptLike;
  }) {
    this.script = ccc.Script.from(script);
    this.udtCode = ccc.OutPoint.from(code);
    this.logicCode = ccc.OutPoint.from(logicCode);
    this.logicScript = ccc.Script.from(logicScript);
    this.daoScript = ccc.Script.from(daoScript);
  }

  /**
   * Computes the iCKB UDT type script from raw UDT and Logic scripts.
   *
   * Concatenates the iCKB logic script hash with the fixed 4-byte little-endian
   * xUDT owner-mode flags postfix ("00000080") to form the UDT type script args.
   *
   * @param udtScript - The raw xUDT script (codeHash and hashType reused).
   * @param ickbLogic - The iCKB logic script (hash used for args).
   * @returns A new Script with the computed args.
   */
  public static typeScriptFrom(udtScript: ccc.Script, ickbLogic: ccc.Script): ccc.Script {
    const { codeHash, hashType } = udtScript;
    return new ccc.Script(
      codeHash,
      hashType,
      ccc.hexFrom(
        ccc.bytesConcat(ickbLogic.hash(), CheckedUint32LE.encode(xudtOwnerMode)),
      ),
    );
  }

  /**
   * Minimum capacity for an iCKB xUDT cell locked by the supplied lock script.
   */
  public static minimumXudtCellCapacity(lock: ccc.Script): ccc.FixedPoint {
    return (
      BigInt(8 + lock.occupiedSize + ickbXudtTypeOccupiedSize + udtDataSize) * ccc.One
    );
  }

  /**
   * Returns true when a cell carries this iCKB xUDT type and enough UDT data.
   */
  public isUdt(cellLike: ccc.CellAnyLike): boolean {
    const cell = ccc.CellAny.from(cellLike);
    return (
      cell.cellOutput.type?.eq(this.script) === true &&
      ccc.bytesFrom(cell.outputData).length >= udtDataSize
    );
  }

  /**
   * Adds iCKB-specific cell dependencies to a transaction.
   *
   * Adds individual code deps (not dep group) for:
   * - xUDT code cell (this.udtCode)
   * - iCKB Logic code cell (this.logicCode)
   *
   * @param txLike - The transaction to add cell deps to.
   * @returns The transaction with cell deps added.
   */
  public addCellDeps(txLike: ccc.TransactionLike): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    addCodeDep(tx, this.udtCode);
    addCodeDep(tx, this.logicCode);
    return tx;
  }

  /**
   * iCKB carried by the transaction's inputs: xUDT balances plus receipt value,
   * minus the first-phase deposits it re-mints. Final withdrawal inputs carry none.
   * The protocol cells are valued at their deposit headers, each read once.
   */
  public async inputBalance(tx: ccc.Transaction, client: ccc.Client): Promise<ccc.Num> {
    const cells = await Promise.all(
      tx.inputs.map(async (input) => {
        try {
          return await input.getCell(client);
        } catch (error) {
          throw new Error(`Failed to load input cell ${input.previousOutput.toHex()}`, {
            cause: error,
          });
        }
      }),
    );
    const valued = cells.map((cell) => this.protocolValue(cell));
    const headers = await transactionHeaders(
      client,
      valued.flatMap((value) => (value === undefined ? [] : [value.txHash])),
    );
    let balance = ccc.Zero;
    for (const [index, cell] of cells.entries()) {
      const value = valued[index];
      if (this.isUdt(cell)) {
        balance += decodeUdtBalance(cell.outputData);
      } else if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every protocol cell's hash was read above.
        const header = headers.get(value.txHash)!;
        balance += value.sign * ickbValue(value.amount, header) * value.quantity;
      }
    }
    return balance;
  }

  /** What a protocol input (receipt or first-phase deposit) is worth once its header is known. */
  private protocolValue(
    cell: ccc.CellAny,
  ):
    | { txHash: ccc.Hex; amount: ccc.FixedPoint; quantity: bigint; sign: bigint }
    | undefined {
    if (this.isUdt(cell) || cell.outPoint === undefined) {
      return undefined;
    }
    const { type, lock } = cell.cellOutput;
    if (type !== undefined && this.logicScript.eq(type)) {
      let receipt: ReturnType<typeof decodeReceiptData>;
      try {
        receipt = decodeReceiptData(cell.outputData);
      } catch (error) {
        throw new Error(
          `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
          { cause: error },
        );
      }
      return {
        txHash: cell.outPoint.txHash,
        amount: receipt.depositAmount,
        quantity: receipt.depositQuantity,
        sign: 1n,
      };
    }
    if (this.logicScript.eq(lock) && isDaoDeposit(cell, this.daoScript)) {
      return {
        txHash: cell.outPoint.txHash,
        amount: cell.capacityFree,
        quantity: 1n,
        sign: -1n,
      };
    }
    return undefined;
  }

  /** iCKB the transaction's outputs require. */
  public outputBalance(tx: ccc.Transaction): ccc.Num {
    return Array.from(tx.outputCells).reduce((required, cell) => {
      return this.isUdt(cell) ? required + decodeUdtBalance(cell.outputData) : required;
    }, ccc.Zero);
  }

  /** Adds the iCKB change output when the surplus is positive; zero needs no output. */
  public addChange(tx: ccc.Transaction, lock: ccc.ScriptLike, balance: ccc.Num): void {
    if (balance <= ccc.Zero) {
      return;
    }
    tx.addOutput({ lock, type: this.script }, CheckedUint128LE.encode(balance));
  }
}

function decodeUdtBalance(data: ccc.BytesLike): ccc.Num {
  return CheckedUint128LE.decode(ccc.bytesFrom(data).slice(0, udtDataSize));
}

function addCodeDep(tx: ccc.Transaction, outPoint: ccc.OutPoint): void {
  if (tx.cellDeps.some((dep) => dep.depType === "code" && dep.outPoint.eq(outPoint))) {
    return;
  }
  tx.addCellDeps({ outPoint, depType: "code" });
}

/**
 * Calculates iCKB value for unoccupied CKB capacity at a deposit header.
 *
 * @remarks
 * Values above {@link ICKB_DEPOSIT_CAP} receive a 10% discount only on the
 * excess amount.
 */
export function ickbValue(
  ckbUnoccupiedCapacity: ccc.FixedPoint,
  header: ccc.ClientBlockHeader,
): ccc.FixedPoint {
  let ickbAmount = convert(true, ckbUnoccupiedCapacity, ickbAccountingRatio(header));
  if (ICKB_DEPOSIT_CAP < ickbAmount) {
    // Apply a 10% discount for the amount exceeding the soft iCKB cap per deposit.
    ickbAmount -= (ickbAmount - ICKB_DEPOSIT_CAP) / 10n;
  }

  return ickbAmount;
}

/**
 * Converts between CKB and iCKB based on an explicit ratio.
 *
 * @param isCkb2Udt - A boolean indicating the direction of conversion (CKB to iCKB or vice versa).
 * @param amount - The amount to convert.
 * @param ratio - The CKB and iCKB scales to use.
 * @returns The converted amount in the target unit as a `ccc.FixedPoint`.
 */
export function convert(
  isCkb2Udt: boolean,
  amount: ccc.FixedPoint,
  ratio: ExchangeRatio,
): ccc.FixedPoint {
  if (ratio.ckbScale <= 0n || ratio.udtScale <= 0n) {
    throw new Error("Exchange ratio scales must be positive");
  }
  return isCkb2Udt
    ? (amount * ratio.ckbScale) / ratio.udtScale
    : (amount * ratio.udtScale) / ratio.ckbScale;
}

/**
 * Calculates the free-capacity accounting ratio at a block header.
 *
 * @param header - The block header whose DAO accumulated rate is used.
 * @returns An object containing the CKB and UDT scales.
 */
export function ickbAccountingRatio(header: ccc.ClientBlockHeader): ExchangeRatio {
  return {
    ckbScale: AR_0,
    udtScale: header.dao.ar,
  };
}

/**
 * Calculates the gross iCKB exchange ratio for a recoverable standard deposit.
 *
 * @remarks Includes the standard deposit's 82 CKB occupied capacity spread
 * over the 100,000 iCKB reference amount.
 */
export function ickbExchangeRatio(header: ccc.ClientBlockHeader): ExchangeRatio {
  return {
    ckbScale: AR_0,
    udtScale: header.dao.ar + depositCapacityDelta,
  };
}
