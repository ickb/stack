import { ccc } from "@ckb-ccc/core";
import { udt } from "@ckb-ccc/udt";
import { ReceiptData } from "./entities.js";
import type { DaoManager } from "@ickb/dao";
import type { ExchangeRatio } from "@ickb/utils";

/**
 * IckbUdt extends CCC's Udt class to provide accurate multi-representation
 * balance for iCKB tokens. The iCKB conservation law is:
 *   Input UDT + Input Receipts = Output UDT + Input Deposits
 *
 * `infoFrom` values three cell types:
 * - xUDT cells: positive balance (standard UDT)
 * - Receipt cells: positive balance (input only, valued via ickbValue)
 * - Deposit cells: negative balance (input only, withdrawal reduces UDT supply)
 *
 * Output cells without outPoint are naturally excluded from receipt/deposit
 * processing, since only input cells (resolved by CellInput.getCell()) have outPoint.
 */
export class IckbUdt extends udt.Udt {
  public readonly logicCode: ccc.OutPoint;
  public readonly logicScript: ccc.Script;
  public readonly daoManager: DaoManager;

  /**
   * Creates an instance of IckbUdt.
   *
   * @param code - The xUDT code cell OutPoint (passed to base Udt/Trait).
   * @param script - The iCKB UDT type script (token identity via args).
   * @param logicCode - The iCKB Logic code cell OutPoint.
   * @param logicScript - The iCKB Logic script.
   * @param daoManager - The DAO manager instance for deposit cell identification.
   */
  constructor(
    code: ccc.OutPointLike,
    script: ccc.ScriptLike,
    logicCode: ccc.OutPointLike,
    logicScript: ccc.ScriptLike,
    daoManager: DaoManager,
  ) {
    super(code, script);
    this.logicCode = ccc.OutPoint.from(logicCode);
    this.logicScript = ccc.Script.from(logicScript);
    this.daoManager = daoManager;
  }

  /**
   * Computes the iCKB UDT type script from raw UDT and Logic scripts.
   *
   * Concatenates the iCKB logic script hash with a fixed 4-byte LE length
   * postfix ("00000080") to form the UDT type script args.
   *
   * @param udt - The raw xUDT script (codeHash and hashType reused).
   * @param ickbLogic - The iCKB logic script (hash used for args).
   * @returns A new Script with the computed args.
   */
  static typeScriptFrom(udt: ccc.Script, ickbLogic: ccc.Script): ccc.Script {
    const { codeHash, hashType } = udt;
    return new ccc.Script(
      codeHash,
      hashType,
      [ickbLogic.hash(), "00000080"].join("") as ccc.Hex,
    );
  }

  /**
   * Computes UDT balance info for iCKB's three cell representations.
   *
   * For each cell:
   * - xUDT cell (type === this.script, data >= 16 bytes): adds positive balance
   * - Receipt cell (type === logicScript, has outPoint): adds positive balance
   *   via ickbValue of deposit amount * quantity
   * - Deposit cell (lock === logicScript, isDeposit, has outPoint): adds negative
   *   balance via ickbValue of free capacity (withdrawal reduces UDT supply)
   *
   * Cells without outPoint (output cells from getOutputsInfo) skip receipt/deposit
   * processing -- correct by design since these only appear as inputs.
   *
   * @param client - CKB client for header fetches (receipt/deposit valuation).
   * @param cells - Cell or array of cells to evaluate.
   * @param acc - Optional accumulator for running totals.
   * @returns UdtInfo with balance, capacity, and count.
   */
  override async infoFrom(
    client: ccc.Client,
    cells: ccc.CellAnyLike | ccc.CellAnyLike[],
    acc?: udt.UdtInfoLike,
  ): Promise<udt.UdtInfo> {
    const info = udt.UdtInfo.from(acc).clone();

    for (const cellLike of [cells].flat()) {
      const cell = ccc.CellAny.from(cellLike);

      // Standard xUDT cell -- delegate to base class pattern
      if (this.isUdt(cell)) {
        info.addAssign({
          balance: udt.Udt.balanceFromUnsafe(cell.outputData),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Receipt and deposit cells need outPoint for header fetch.
      // Output cells (no outPoint) are skipped -- correct by design.
      if (!cell.outPoint) {
        continue;
      }

      const { type, lock } = cell.cellOutput;

      // Receipt cell: type === logicScript
      if (type && this.logicScript.eq(type)) {
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for txHash");
        }

        const { depositQuantity, depositAmount } =
          ReceiptData.decode(cell.outputData);
        info.addAssign({
          balance: ickbValue(depositAmount, txWithHeader.header) *
            depositQuantity,
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }

      // Deposit cell: lock === logicScript AND isDeposit
      // Output cells are gated by the !cell.outPoint check above and never reach here.
      if (
        this.logicScript.eq(lock) &&
        this.daoManager.isDeposit(cell)
      ) {
        const txWithHeader = await client.getTransactionWithHeader(
          cell.outPoint.txHash,
        );
        if (!txWithHeader?.header) {
          throw new Error("Header not found for txHash");
        }

        info.addAssign({
          balance: -ickbValue(cell.capacityFree, txWithHeader.header),
          capacity: cell.cellOutput.capacity,
          count: 1,
        });
        continue;
      }
    }

    return info;
  }

  /**
   * Adds iCKB-specific cell dependencies to a transaction.
   *
   * Adds individual code deps (not dep group) for:
   * - xUDT code cell (this.code from ssri.Trait)
   * - iCKB Logic code cell (this.logicCode)
   *
   * @param txLike - The transaction to add cell deps to.
   * @returns The transaction with cell deps added.
   */
  override addCellDeps(txLike: ccc.TransactionLike): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    // xUDT code dep
    tx.addCellDeps({ outPoint: this.code, depType: "code" });
    // iCKB Logic code dep
    tx.addCellDeps({ outPoint: this.logicCode, depType: "code" });
    return tx;
  }
}

/**
 * Calculates the iCKB value based on the unoccupied CKB capacity and the block header.
 *
 * @param ckbUnoccupiedCapacity - The unoccupied capacity in CKB.
 * @param header - The block header used for conversion.
 * @returns The calculated iCKB amount.
 */
export function ickbValue(
  ckbUnoccupiedCapacity: ccc.FixedPoint,
  header: ccc.ClientBlockHeader,
): ccc.FixedPoint {
  let ickbAmount = convert(true, ckbUnoccupiedCapacity, header, false);
  if (ICKB_DEPOSIT_CAP < ickbAmount) {
    // Apply a 10% discount for the amount exceeding the soft iCKB cap per deposit.
    ickbAmount -= (ickbAmount - ICKB_DEPOSIT_CAP) / 10n;
  }

  return ickbAmount;
}

/** The maximum deposit cap for iCKB, set to 100,000 iCKB. */
export const ICKB_DEPOSIT_CAP = ccc.fixedPointFrom(100000); // 100,000 iCKB

/**
 * Converts between CKB and iCKB based on the provided ratio.
 *
 * @param isCkb2Udt - A boolean indicating the direction of conversion (CKB to iCKB or vice versa).
 * @param amount - The amount to convert.
 * @param rate - The ratio information for conversion, which can be either:
 *   - An object containing `ckbScale` and `udtScale`.
 *   - A `ccc.ClientBlockHeader` for header information.
 * @param accountDepositCapacity - A boolean indicating whether to account for deposit capacity
 *  when using ccc.ClientBlockHeader (default: true).
 * @returns The converted amount in the target unit as a `ccc.FixedPoint`.
 */
export function convert(
  isCkb2Udt: boolean,
  amount: ccc.FixedPoint,
  rate: ExchangeRatio | ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ccc.FixedPoint {
  if ("dao" in rate) {
    rate = ickbExchangeRatio(rate, accountDepositCapacity);
  }
  return isCkb2Udt
    ? (amount * rate.ckbScale) / rate.udtScale
    : (amount * rate.udtScale) / rate.ckbScale;
}

/**
 * Calculates the iCKB exchange ratio based on the block header and deposit capacity.
 *
 * @param header - The block header used for calculating the exchange ratio.
 * @param accountDepositCapacity - A boolean indicating whether to account for the deposit capacity in the calculation.
 * @returns An object containing the CKB and UDT scales.
 */
export function ickbExchangeRatio(
  header: ccc.ClientBlockHeader,
  accountDepositCapacity = true,
): ExchangeRatio {
  const AR_m = header.dao.ar;
  return {
    ckbScale: AR_0,
    udtScale: accountDepositCapacity ? AR_m + depositCapacityDelta : AR_m,
  };
}

// Constants used in calculations
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ICKB_DEPOSIT_CAP; // Delta for deposit capacity
