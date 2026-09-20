import { ccc } from "@ckb-ccc/core";
import {
  assertDaoOutputLimit,
  DaoOutputLimitError,
  depositData,
  depositMaturity,
  isDaoDeposit,
  pushHeaderDep,
  type LockUpPolicy,
} from "./dao.ts";
import {
  decodeReceiptData,
  encodeReceiptData,
  IckbUdt,
  ickbValue,
  receiptDataBytes,
  type ReceiptData,
} from "./udt.ts";
import { transactionHeaders } from "./utils/transaction_header.ts";
import {
  findCells,
  type ScriptDeps,
  type TransactionHeader,
  type ValueComponents,
} from "./utils/utils.ts";

const maxDepositQuantity = 63;
// Receipts must carry enough capacity for phase 2 when the wallet has no other
// CKB: one iCKB xUDT cell, one plain capacity cell, and the fee reserve.
const phase2TxFeeReserve = ccc.One;

/**
 * A live iCKB deposit: a DAO deposit cell locked by the iCKB Logic script, valued at its
 * deposit header.
 */
export interface IckbDepositCell extends ValueComponents {
  /** The DAO deposit cell. */
  cell: ccc.Cell;
  /** The deposit header and the tip the readiness was judged against. */
  headers: [TransactionHeader, TransactionHeader];
  /** The DAO interest accrued between the two headers. */
  interests: ccc.Num;
  /**
   * The DAO claim epoch as sampled at the tip, not rolled: each reader judges it against
   * its own {@link LockUpPolicy} with `depositMaturity`.
   */
  claimEpoch: ccc.Epoch;
}

/**
 * Represents a receipt cell containing the receipt for iCKB Deposits.
 */
export interface ReceiptCell extends ValueComponents {
  /** The cell associated with the receipt. */
  cell: ccc.Cell;
  /** The header of the transaction that made the deposits. */
  header: TransactionHeader;
}

/**
 * Manages logic related to deposits and receipts in the blockchain.
 */
export class LogicManager implements ScriptDeps {
  /** The iCKB Logic script used as receipt type and DAO deposit lock. */
  public readonly script: ccc.Script;

  /** Cell dependencies required to execute the iCKB Logic script. */
  public readonly cellDeps: ccc.CellDep[];

  /** The Nervos DAO script the deposits carry, with its cell deps. */
  public readonly dao: ScriptDeps;

  /** Creates the manager for one iCKB Logic deployment over one DAO deployment. */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[], dao: ScriptDeps) {
    this.script = script;
    this.cellDeps = cellDeps;
    this.dao = dao;
  }

  /** Whether the cell is an iCKB receipt: typed by the logic script with a decodable prefix. */
  public isReceipt(cell: ccc.Cell): boolean {
    return (
      cell.cellOutput.type?.eq(this.script) === true &&
      ccc.bytesFrom(cell.outputData).length >= receiptDataBytes
    );
  }

  /** Whether the cell is a DAO deposit locked by the logic script. */
  public isDeposit(cell: ccc.Cell): boolean {
    return isDaoDeposit(cell, this.dao.script) && cell.cellOutput.lock.eq(this.script);
  }

  /**
   * Adds `depositQuantity` DAO deposits of `depositCapacity` locked by the logic script,
   * then the receipt that mints their iCKB in phase 2, locked by `lock`.
   *
   * @remarks Caller must ensure UDT cellDeps are added to the transaction
   * (e.g., via ickbUdt.addCellDeps(tx)).
   */
  public deposit(
    txLike: ccc.TransactionLike,
    depositQuantity: number,
    depositCapacity: ccc.FixedPoint,
    lock: ccc.Script,
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (depositQuantity <= 0) {
      return tx;
    }
    if (!Number.isSafeInteger(depositQuantity)) {
      throw new TypeError("iCKB deposit quantity must be a safe integer");
    }
    if (depositQuantity > maxDepositQuantity) {
      // The completion walk steps a plan down on this error (decisions amendment 52, N7).
      throw new DaoOutputLimitError(tx.outputs.length + depositQuantity + 1);
    }

    const depositCell = ccc.Cell.from({
      previousOutput: { txHash: `0x${"00".repeat(32)}`, index: 0 },
      cellOutput: { capacity: depositCapacity, lock: this.script, type: this.dao.script },
      outputData: depositData(),
    });
    const depositAmount = depositCell.capacityFree;
    if (depositAmount < ccc.fixedPointFrom(1000)) {
      throw new Error(
        "iCKB deposit minimum is 1000 CKB free capacity (1082 CKB total capacity)",
      );
    }
    if (depositAmount > ccc.fixedPointFrom(1000000)) {
      throw new Error(
        "iCKB deposit maximum is 1000000 CKB free capacity (1000082 CKB total capacity)",
      );
    }

    tx.addCellDeps(this.cellDeps);
    tx.addCellDeps(this.dao.cellDeps);
    for (let i = 0; i < depositQuantity; i += 1) {
      tx.addOutput(depositCell.cellOutput, depositCell.outputData);
    }
    // Receipts track the deposit's free capacity, not the full DAO cell capacity.
    tx.addOutput(
      { capacity: receiptPhase2Capacity(lock), lock, type: this.script },
      encodeReceiptData({ depositQuantity: BigInt(depositQuantity), depositAmount }),
    );
    assertDaoOutputLimit(tx, this.dao.script);
    return tx;
  }

  /**
   * Adds receipt inputs and their deposit header deps for iCKB deposit completion.
   *
   * @remarks This prepares the phase-2 inputs; the iCKB they mint is completed by
   * `IckbSdk.completeTransaction`.
   */
  public completeDeposit(
    txLike: ccc.TransactionLike,
    receipts: ReceiptCell[],
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (receipts.length === 0) {
      return tx;
    }
    for (const receipt of receipts) {
      const outPoint = receipt.cell.outPoint.toHex();
      if (!this.isReceipt(receipt.cell)) {
        throw new Error(
          `Receipt ${outPoint} is not an iCKB receipt for this logic script`,
        );
      }
      if (receipt.header.txHash !== receipt.cell.outPoint.txHash) {
        throw new Error(
          `Receipt ${outPoint} header txHash ${String(receipt.header.txHash)} does not match cell txHash ${receipt.cell.outPoint.txHash}`,
        );
      }
    }
    tx.addCellDeps(this.cellDeps);
    for (const receipt of receipts) {
      pushHeaderDep(tx, receipt.header.header.hash);
      tx.addInput(receipt.cell);
    }
    return tx;
  }

  /**
   * The receipts among `cells`, valued at their deposit headers, each header read once.
   */
  public async receiptsFrom(
    client: ccc.Client,
    cells: readonly ccc.Cell[],
  ): Promise<ReceiptCell[]> {
    const receipts = cells.filter((cell) => this.isReceipt(cell));
    const headers = await transactionHeaders(
      client,
      receipts.map((cell) => cell.outPoint.txHash),
    );
    return receipts.map((cell) => {
      const { txHash } = cell.outPoint;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every receipt's hash was read above.
      return receiptCell(cell, { header: headers.get(txHash)!, txHash });
    });
  }

  /**
   * Every live iCKB deposit, valued at its deposit header, with its claim epoch at the tip;
   * each deposit transaction's header is read once.
   */
  public async findDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
  ): Promise<IckbDepositCell[]> {
    const cells = (
      await findCells(client, {
        script: this.script,
        scriptType: "lock",
        filter: {
          script: this.dao.script,
          outputData: depositData(),
          outputDataSearchMode: "exact",
        },
        scriptSearchMode: "exact",
        withData: true,
      })
    ).filter((cell) => this.isDeposit(cell));
    const headers = await transactionHeaders(
      client,
      cells.map((cell) => cell.outPoint.txHash),
    );
    return cells.map((cell) => {
      const { txHash } = cell.outPoint;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every deposit's hash was read above.
      return ickbDepositCell(cell, { header: headers.get(txHash)!, txHash }, tip);
    });
  }
}

/** Values a DAO deposit cell at its deposit header and samples its claim epoch at the tip. */
export function ickbDepositCell(
  cell: ccc.Cell,
  depositHeader: TransactionHeader,
  tip: ccc.ClientBlockHeader,
): IckbDepositCell {
  const interests = ccc.calcDaoProfit(cell.capacityFree, depositHeader.header, tip);
  return {
    cell,
    headers: [depositHeader, { header: tip }],
    interests,
    claimEpoch: ccc.calcDaoClaimEpoch(depositHeader.header, tip),
    ckbValue: cell.cellOutput.capacity + interests,
    udtValue: ickbValue(cell.capacityFree, depositHeader.header),
  };
}

/** The deposits a withdrawal request made now may claim at their sampled dates under the policy. */
export function readyDeposits(
  deposits: readonly IckbDepositCell[],
  tip: ccc.ClientBlockHeader,
  policy: LockUpPolicy,
): IckbDepositCell[] {
  return deposits.filter(
    (deposit) => depositMaturity(deposit.claimEpoch, tip, policy).isReady,
  );
}

/** Decodes a receipt cell and values it at its deposit header. */
export function receiptCell(cell: ccc.Cell, header: TransactionHeader): ReceiptCell {
  let receipt: ReceiptData;
  try {
    receipt = decodeReceiptData(cell.outputData);
  } catch (error) {
    throw new Error(
      `Invalid iCKB receipt payload at ${cell.outPoint.toHex()}: ${cell.outputData}`,
      { cause: error },
    );
  }
  return {
    cell,
    header,
    ckbValue: cell.cellOutput.capacity,
    udtValue: ickbValue(receipt.depositAmount, header.header) * receipt.depositQuantity,
  };
}

/**
 * Returns the CKB needed for the two phase-2 outputs created by one receipt.
 *
 * @remarks The value is sized with the actual user lock because lock args affect
 * occupied capacity. It includes one plain output, one xUDT output, and the
 * phase-2 fee reserve.
 */
export function receiptPhase2Capacity(lock: ccc.Script): ccc.FixedPoint {
  // Capacity is measured with the actual user lock. Lock args are wallet-specific
  // and can make both phase-2 outputs larger than protocol-only examples.
  const plainCellCapacity = BigInt(8 + lock.occupiedSize) * ccc.One;
  return plainCellCapacity + IckbUdt.minimumXudtCellCapacity(lock) + phase2TxFeeReserve;
}
