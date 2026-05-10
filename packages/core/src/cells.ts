import { ccc } from "@ckb-ccc/core";
import { type TransactionHeader, type ValueComponents } from "@ickb/utils";
import { OwnerData, ReceiptData } from "./entities.js";
import { ickbValue } from "./udt.js";
import type { DaoDepositCell, DaoWithdrawalRequestCell } from "@ickb/dao";

export interface IckbDepositCell extends DaoDepositCell {
  /**
   * A symbol property indicating that this cell is a Ickb Deposit Cell.
   * This property is always set to true.
   */
  [isIckbDepositSymbol]: true;
}

// Symbol to represent the isIckbDeposit property of Ickb Deposit Cells
const isIckbDepositSymbol = Symbol("isIckbDeposit");

export function ickbDepositCellFrom(daoCell: DaoDepositCell): IckbDepositCell {
  return {
    ...daoCell,
    udtValue: ickbValue(daoCell.cell.capacityFree, daoCell.headers[0].header),
    [isIckbDepositSymbol]: true,
  };
}

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 */
export interface ReceiptCell extends ValueComponents {
  /** The cell associated with the receipt. */
  cell: ccc.Cell;

  /** The transaction header associated with the receipt cell. */
  header: TransactionHeader;
}

/**
 * Creates a ReceiptCell instance from the provided options.
 * @param options - Options for creating a ReceiptCell.
 * @returns A promise that resolves to a ReceiptCell instance.
 * @throws ReceiptCellError if the cell is not found.
 */
export async function receiptCellFrom(
  options:
    | {
        cell: ccc.Cell;
        client: ccc.Client;
      }
    | {
        outpoint: ccc.OutPoint;
        client: ccc.Client;
      },
): Promise<ReceiptCell> {
  const cell =
    "cell" in options
      ? options.cell
      : await options.client.getCell(options.outpoint);
  if (!cell) {
    throw new Error("Cell not found");
  }

  const txHash = cell.outPoint.txHash;
  const txWithHeader =
    await options.client.getTransactionWithHeader(txHash);
  if (!txWithHeader?.header) {
    throw new Error("Header not found for txHash");
  }
  const header: TransactionHeader = {
    header: txWithHeader.header,
    txHash,
  };
  const { depositQuantity, depositAmount } = ReceiptData.decodePrefix(
    cell.outputData,
  );

  return {
    cell,
    header,
    ckbValue: cell.cellOutput.capacity,
    udtValue: ickbValue(depositAmount, header.header) * depositQuantity,
  };
}

/**
 * Represents a WithdrawalGroup
 *
 * @property owned - The DAO withdrawal request cell associated with the group.
 * @property owner - The owner cell associated with the group.
 */
export class WithdrawalGroup implements ValueComponents {
  constructor(
    public owned: DaoWithdrawalRequestCell,
    public owner: OwnerCell,
  ) {}

  /**
   * Gets the CKB value of the group.
   *
   * @returns The total CKB amount as a `ccc.FixedPoint`, which is the sum of the CKB values of the owned cell and the owner cell.
   */
  get ckbValue(): ccc.FixedPoint {
    return this.owned.ckbValue + this.owner.cell.cellOutput.capacity;
  }

  /**
   * Gets the UDT value of the group.
   *
   * @returns The iCKB amount represented by the owned withdrawal request.
   */
  get udtValue(): ccc.FixedPoint {
    return ickbValue(this.owned.cell.capacityFree, this.owned.headers[0].header);
  }
}

/**
 * Represents a cell that contains ownership information.
 */
export class OwnerCell implements ValueComponents {
  /**
   * Creates an instance of OwnerCell.
   *
   * @param cell - The cell associated with the owner.
   */
  constructor(public cell: ccc.Cell) {}

  /**
   * Gets the CKB value of the cell.
   *
   * @returns The CKB amount as a `ccc.FixedPoint` taken from the cell's capacity.
   */
  get ckbValue(): ccc.FixedPoint {
    return this.cell.cellOutput.capacity;
  }

  /**
   * Gets the UDT value of the cell.
   *
   * For an OwnerCell, the UDT amount is always zero.
   *
   * @returns The UDT amount as a `ccc.FixedPoint` (0n).
   */
  readonly udtValue = 0n;

  /**
   * Retrieves the out point of the owned cell based on the owner's distance.
   *
   * Decodes the prefix of the cell's output data to determine the distance from the owner
   * and then calculates the new index for the out point.
   *
   * @returns The out point of the owned cell as a `ccc.OutPoint`.
   */
  getOwned(): ccc.OutPoint {
    const { txHash, index } = this.cell.outPoint;
    const { ownedDistance } = OwnerData.decodePrefix(this.cell.outputData);
    return new ccc.OutPoint(txHash, index + ownedDistance);
  }
}
