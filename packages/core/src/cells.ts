import { ccc } from "@ckb-ccc/core";
import type { DaoDepositCell, DaoWithdrawalRequestCell } from "@ickb/dao";
import type { TransactionHeader, ValueComponents } from "@ickb/utils";
import { OwnerData, ReceiptData } from "./entities.ts";
import { ickbValue } from "./udt.ts";

// Symbol marker keeps the runtime tag off the public shape except by this module.
const isIckbDepositSymbol = Symbol("isIckbDeposit");

/**
 * Represents a DAO deposit cell with its iCKB value computed from the deposit header.
 *
 * @public
 */
export interface IckbDepositCell extends DaoDepositCell {
  /**
   * A symbol property indicating that this cell is a Ickb Deposit Cell.
   * This property is always set to true.
   */
  [isIckbDepositSymbol]: true;
}

/**
 * Converts a DAO deposit cell into an iCKB deposit cell.
 *
 * @public
 */
export function ickbDepositCellFrom(
  daoCell: DaoDepositCell,
  logicScript: ccc.ScriptLike,
): IckbDepositCell {
  const expectedLock = ccc.Script.from(logicScript);
  if (!daoCell.cell.cellOutput.lock.eq(expectedLock)) {
    throw new Error(
      `DAO deposit ${daoCell.cell.outPoint.toHex()} lock does not match iCKB logic script`,
    );
  }

  return {
    ...daoCell,
    udtValue: ickbValue(daoCell.cell.capacityFree, daoCell.headers[0].header),
    [isIckbDepositSymbol]: true,
  };
}

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 *
 * @public
 */
export interface ReceiptCell extends ValueComponents {
  /** The cell associated with the receipt. */
  cell: ccc.Cell;

  /** The transaction header associated with the receipt cell. */
  header: TransactionHeader;
}

type TransactionWithHeader = Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>;

interface ReceiptCellFromCache {
  /** Reuses transaction-with-header reads across receipt conversions in one scan. */
  transactionCache?: Map<ccc.Hex, Promise<TransactionWithHeader>>;
}

/**
 * Loads and decodes an iCKB receipt cell from a cell or out point.
 *
 * @remarks `transactionCache` is scoped to one coherent read batch; it does not refresh transaction headers.
 */
export async function receiptCellFrom(
  options:
    | ({
        cell: ccc.Cell;
        client: ccc.Client;
      } & ReceiptCellFromCache)
    | ({
        outpoint: ccc.OutPoint;
        client: ccc.Client;
      } & ReceiptCellFromCache),
): Promise<ReceiptCell> {
  let cell: ccc.Cell;
  if ("cell" in options) {
    cell = options.cell;
  } else {
    let loadedCell: ccc.Cell | undefined;
    try {
      loadedCell = await options.client.getCell(options.outpoint);
    } catch (error) {
      throw new Error(`Failed to load cell for out point ${options.outpoint.toHex()}`, {
        cause: error,
      });
    }
    if (loadedCell === undefined) {
      throw new Error(`Cell not found for out point ${options.outpoint.toHex()}`);
    }
    cell = loadedCell;
  }

  const txHash = cell.outPoint.txHash;
  let txWithHeaderPromise = options.transactionCache?.get(txHash);
  if (txWithHeaderPromise === undefined) {
    txWithHeaderPromise = getReceiptTransactionWithHeader(options.client, cell.outPoint);
    options.transactionCache?.set(txHash, txWithHeaderPromise);
  }
  const txWithHeader = await txWithHeaderPromise;
  if (txWithHeader?.header === undefined) {
    throw new Error(`Header not found for txHash ${txHash} at ${cell.outPoint.toHex()}`);
  }
  const header: TransactionHeader = {
    header: txWithHeader.header,
    txHash,
  };
  let receipt: ReturnType<typeof ReceiptData.decodePrefix>;
  try {
    receipt = ReceiptData.decodePrefix(cell.outputData);
  } catch (error) {
    throw new Error(
      `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
      { cause: error },
    );
  }
  const { depositQuantity, depositAmount } = receipt;

  return {
    cell,
    header,
    ckbValue: cell.cellOutput.capacity,
    udtValue: ickbValue(depositAmount, header.header) * depositQuantity,
  };
}

async function getReceiptTransactionWithHeader(
  client: ccc.Client,
  outPoint: ccc.OutPoint,
): Promise<TransactionWithHeader> {
  try {
    return await client.getTransactionWithHeader(outPoint.txHash);
  } catch (error) {
    throw new Error(
      `Failed to load transaction header for txHash ${outPoint.txHash} at ${outPoint.toHex()}`,
      { cause: error },
    );
  }
}

/**
 * Pairs an owned DAO withdrawal request with the owner marker cell that points to it.
 *
 * @public
 */
export class WithdrawalGroup implements ValueComponents {
  /** The decoded DAO withdrawal request controlled by this owner marker. */
  public owned: DaoWithdrawalRequestCell;

  /** The owner marker cell that references the owned withdrawal request. */
  public owner: OwnerCell;

  /** Creates a withdrawal group from a decoded request and its owner marker. */
  constructor(owned: DaoWithdrawalRequestCell, owner: OwnerCell) {
    this.owned = owned;
    this.owner = owner;
  }

  /**
   * Returns the total CKB capacity in the owned withdrawal and owner marker cells.
   */
  public get ckbValue(): ccc.FixedPoint {
    return this.owned.ckbValue + this.owner.cell.cellOutput.capacity;
  }

  /**
   * Returns the iCKB amount represented by the owned withdrawal request.
   */
  public get udtValue(): ccc.FixedPoint {
    return ickbValue(this.owned.cell.capacityFree, this.owned.headers[0].header);
  }
}

/**
 * Wraps an owner marker cell that references an owned withdrawal request.
 *
 * @public
 */
export class OwnerCell implements ValueComponents {
  /** The live owner marker cell whose output data points to the owned request. */
  public cell: ccc.Cell;

  /**
   * Owner marker cells carry no UDT value.
   */
  public readonly udtValue = 0n;

  /**
   * Creates an owner marker wrapper for a live cell.
   */
  constructor(cell: ccc.Cell) {
    this.cell = cell;
  }

  /**
   * Returns the CKB capacity held by the owner marker cell.
   */
  public get ckbValue(): ccc.FixedPoint {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Returns the owned withdrawal request out point referenced by this owner marker.
   *
   * @remarks
   * Owner data stores a signed output-index distance. The owned cell is resolved
   * on the same transaction hash as the owner marker cell.
   */
  public getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    let ownerData: ReturnType<typeof OwnerData.decodePrefix>;
    try {
      ownerData = OwnerData.decodePrefix(this.cell.outputData);
    } catch (error) {
      throw new Error(
        `Invalid owner marker payload at ${this.cell.outPoint.toHex()}: ${this.cell.outputData}`,
        { cause: error },
      );
    }
    const { ownedDistance } = ownerData;
    const ownedIndex = index + ownedDistance;
    if (ownedIndex < 0n) {
      throw new Error(
        `Owner marker ${this.cell.outPoint.toHex()} points before output 0 with distance ${String(ownedDistance)}`,
      );
    }
    return new ccc.OutPoint(txHash, ownedIndex);
  }
}
