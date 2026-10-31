import { ccc } from "@ckb-ccc/core";
import { isDaoDeposit } from "./dao.ts";
import { CheckedUint128LE, CheckedUint32LE } from "./utils/codec.ts";
import type { ExchangeRatio } from "./utils/utils.ts";

const ickbXudtTypeOccupiedSize = 69;
const udtDataSize = 16;
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ccc.fixedPointFrom(100000);
const xudtOwnerMode = 0x80000000n;

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

  /** The iCKB dep group, which also carries the xUDT and iCKB Logic code cells. */
  public readonly cellDeps: ccc.CellDep[];

  /** Logic script whose hash is embedded in this iCKB xUDT type script. */
  public readonly logicScript: ccc.Script;

  /** The Nervos DAO script, to recognize the first-phase deposits a transaction re-mints. */
  public readonly daoScript: ccc.Script;

  /** Creates an instance of IckbUdt from its code and script references. */
  constructor({
    script,
    cellDeps,
    logicScript,
    daoScript,
  }: {
    script: ccc.ScriptLike;
    cellDeps: ccc.CellDepLike[];
    logicScript: ccc.ScriptLike;
    daoScript: ccc.ScriptLike;
  }) {
    this.script = ccc.Script.from(script);
    this.cellDeps = cellDeps.map((cellDep) => ccc.CellDep.from(cellDep));
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
   * iCKB carried by the transaction's inputs: xUDT balances plus receipt value, minus the
   * first-phase deposits it re-mints. Receipts and deposits take the value the state read
   * gave them at their deposit headers; a protocol input missing from `protocolCells` is
   * a builder bug and throws, since iCKB Logic would refuse whatever it was valued at.
   */
  public async inputBalance(
    tx: ccc.Transaction,
    client: ccc.Client,
    protocolCells: readonly ProtocolCell[],
  ): Promise<ccc.Num> {
    const values = new Map(
      protocolCells.map(({ cell, udtValue }) => [cell.outPoint.toHex(), udtValue]),
    );
    let balance = ccc.Zero;
    for (const input of tx.inputs) {
      const cell = await input.getCell(client);
      if (this.isUdt(cell)) {
        balance += ccc.udtBalanceFrom(cell.outputData);
        continue;
      }
      const sign = this.protocolSign(cell);
      if (sign === 0n) {
        continue;
      }
      const value = values.get(cell.outPoint.toHex());
      if (value === undefined) {
        throw new Error(
          `iCKB input ${cell.outPoint.toHex()} has no value from the state read`,
        );
      }
      balance += sign * value;
    }
    return balance;
  }

  /** 1 for a receipt, -1 for a first-phase iCKB deposit, 0 for any other cell. */
  private protocolSign(cell: ccc.Cell): bigint {
    const { type, lock } = cell.cellOutput;
    if (type !== undefined && this.logicScript.eq(type)) {
      return 1n;
    }
    return this.logicScript.eq(lock) && isDaoDeposit(cell, this.daoScript) ? -1n : 0n;
  }

  /** Adds the iCKB change output when the surplus is positive; zero needs no output. */
  public addChange(tx: ccc.Transaction, lock: ccc.ScriptLike, balance: ccc.Num): void {
    if (balance <= ccc.Zero) {
      return;
    }
    tx.addOutput({ lock, type: this.script }, CheckedUint128LE.encode(balance));
  }
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
  let ickbAmount = udtFromCkb(ckbUnoccupiedCapacity, ickbAccountingRatio(header));
  if (ICKB_DEPOSIT_CAP < ickbAmount) {
    // Apply a 10% discount for the amount exceeding the soft iCKB cap per deposit.
    ickbAmount -= (ickbAmount - ICKB_DEPOSIT_CAP) / 10n;
  }

  return ickbAmount;
}

/** The iCKB worth `amount` CKB at `ratio`, rounded down. */
export function udtFromCkb(amount: ccc.FixedPoint, ratio: ExchangeRatio): ccc.FixedPoint {
  assertPositive(ratio);
  return (amount * ratio.ckbScale) / ratio.udtScale;
}

/** The CKB worth `amount` iCKB at `ratio`, rounded down. */
export function ckbFromUdt(amount: ccc.FixedPoint, ratio: ExchangeRatio): ccc.FixedPoint {
  assertPositive(ratio);
  return (amount * ratio.udtScale) / ratio.ckbScale;
}

function assertPositive({ ckbScale, udtScale }: ExchangeRatio): void {
  if (ckbScale <= 0n || udtScale <= 0n) {
    throw new Error("Exchange ratio scales must be positive");
  }
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

/** A receipt or iCKB deposit with the iCKB value the state read gave it. */
export interface ProtocolCell {
  cell: ccc.Cell;
  udtValue: ccc.Num;
}
