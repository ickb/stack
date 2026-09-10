import { ccc } from "@ckb-ccc/core";
import type { ScriptDeps } from "../utils/index.ts";
import {
  type IckbDepositCell,
  ickbDepositCellFrom,
  type ReceiptCell,
  receiptCellFrom,
} from "./cells.ts";
import { DaoManager } from "./dao.ts";
import { assertDaoOutputLimit, DaoOutputLimitError } from "./dao_output_limit.ts";
import { ReceiptData } from "./entities.ts";
import { IckbUdt } from "./udt.ts";

const maxDepositQuantity = 63;
const receiptDataPrefixByteLength = 12;
// Receipts must carry enough capacity for phase 2 when the wallet has no other
// CKB: one iCKB xUDT cell, one plain capacity cell, and the fee reserve.
const phase2TxFeeReserve = ccc.One;

/**
 * Manages logic related to deposits and receipts in the blockchain.
 * Implements the ScriptDeps interface.
 *
 * @public
 */
export class LogicManager implements ScriptDeps {
  /** The iCKB Logic script used as receipt type and DAO deposit lock. */
  public readonly script: ccc.Script;

  /** Cell dependencies required to execute the iCKB Logic script. */
  public readonly cellDeps: ccc.CellDep[];

  /** DAO helper used for deposit and withdrawal cell construction. */
  public readonly daoManager: DaoManager;

  /**
   * Creates an instance of LogicManager.
   *
   * @param script - The script associated with the manager.
   * @param cellDeps - The cell dependencies for the manager.
   * @param daoManager - The DAO manager for handling deposits and receipts.
   */
  constructor(script: ccc.Script, cellDeps: ccc.CellDep[], daoManager: DaoManager) {
    this.script = script;
    this.cellDeps = cellDeps;
    this.daoManager = daoManager;
  }

  /**
   * Checks if the specified cell is an iCKB receipt.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a receipt, otherwise false.
   */
  public isReceipt(cell: ccc.Cell): boolean {
    return (
      cell.cellOutput.type?.eq(this.script) === true &&
      ccc.bytesFrom(cell.outputData).length >= receiptDataPrefixByteLength
    );
  }

  /**
   * Checks if the specified cell is an iCKB deposit.
   *
   * @param cell - The cell to check.
   * @returns True if the cell is a deposit, otherwise false.
   */
  public isDeposit(cell: ccc.Cell): boolean {
    return this.daoManager.isDeposit(cell) && cell.cellOutput.lock.eq(this.script);
  }

  /**
   * Processes a deposit transaction.
   *
   * @param txLike - The transaction to add the deposit to.
   * @param depositQuantity - The quantity of deposits.
   * @param depositCapacity - The total capacity of each deposit output.
   * @param lock - The lock script for the output receipt cell.
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
    let tx = ccc.Transaction.from(txLike);
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
      previousOutput: {
        txHash: `0x${"00".repeat(32)}`,
        index: 0,
      },
      cellOutput: {
        capacity: depositCapacity,
        lock: this.script,
        type: this.daoManager.script,
      },
      outputData: DaoManager.depositData(),
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

    const capacities = Array.from({ length: depositQuantity }, () => depositCapacity);
    tx = this.daoManager.deposit(tx, capacities, this.script);

    // Receipts track the deposit's free capacity, not the full DAO cell capacity.
    tx.addOutput(
      {
        capacity: receiptPhase2Capacity(lock),
        lock,
        type: this.script,
      },
      ReceiptData.encode({ depositQuantity, depositAmount }),
    );

    assertDaoOutputLimit(tx, this.daoManager.script);
    return tx;
  }

  /**
   * Adds receipt inputs and required header deps for iCKB deposit completion.
   *
   * @param txLike - The transaction to add the receipts to.
   * @param receipts - The receipts to add to the transaction.
   *
   * @remarks This prepares the phase-2 inputs. UDT cell deps and xUDT balance
   * completion remain caller-owned, for example through `ickbUdt.addCellDeps(tx)`
   * and `ickbUdt.completeBy(...)`.
   */
  public completeDeposit(
    txLike: ccc.TransactionLike,
    receipts: ReceiptCell[],
  ): ccc.Transaction {
    const tx = ccc.Transaction.from(txLike);
    if (receipts.length === 0) {
      return tx;
    }

    this.assertReceiptInputsUnspent(tx, receipts);
    const headerHashes: ccc.Hex[] = [];
    for (const r of receipts) {
      this.assertReceiptForCompletion(r);
      const hash = r.header.header.hash;
      if (!headerHashes.includes(hash) && !tx.headerDeps.includes(hash)) {
        headerHashes.push(hash);
      }
    }

    tx.addCellDeps(this.cellDeps);
    tx.headerDeps.push(...headerHashes);
    for (const { cell } of receipts) {
      tx.addInput(cell);
    }
    return tx;
  }

  /**
   * Converts the receipt cells among `cells` into receipts.
   *
   * @remarks The caller enumerates the account's cells once; this only recognizes
   * receipts and reads each deposit header, sharing one transaction cache per batch.
   */
  public async receiptsFrom(
    client: ccc.Client,
    cells: readonly ccc.Cell[],
  ): Promise<ReceiptCell[]> {
    const transactionCache = new Map<
      ccc.Hex,
      Promise<Awaited<ReturnType<ccc.Client["getTransactionWithHeader"]>>>
    >();
    return Promise.all(
      cells
        .filter((cell) => this.isReceipt(cell))
        .map(async (cell) => receiptCellFrom({ client, cell, transactionCache })),
    );
  }

  /**
   * Async generator that finds and yields iCKB deposit cells.
   *
   * Wraps DAO deposit detection for the iCKB token by delegating
   * to `this.daoManager.findDeposits` and converting results.
   *
   * @param client - CKB client used for tip/header reads and cell queries.
   * @param options - Search options. `tip` controls epoch calculations;
   * `minLockUp` and `maxLockUp` override the DAO helper windows.
   *
   * @returns
   *   An async generator yielding `IckbDepositCell` objects, each representing
   *   an iCKB deposit derived from a DAO deposit cell.
   *
   * @remarks
   * - Enforces that `options.tip` is a `ClientBlockHeader` instance by calling
   *   `ClientBlockHeader.from(...)` if a plain object is provided.
   * - Delegates to `this.daoManager.findDeposits(client, [this.script], options)` to locate
   *   raw DAO deposit cells locked under `this.script`.
   * - Converts each validated DAO deposit into an `IckbDepositCell` via `ickbDepositCellFrom`.
   */
  public async *findDeposits(
    client: ccc.Client,
    options?: {
      tip?: ccc.ClientBlockHeader;
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): AsyncGenerator<IckbDepositCell> {
    const tip =
      options?.tip === undefined
        ? await client.getTipHeader()
        : ccc.ClientBlockHeader.from(options.tip);
    for await (const deposit of this.daoManager.findDeposits(client, [this.script], {
      ...options,
      tip,
    })) {
      if (!this.isDeposit(deposit.cell)) {
        continue;
      }
      yield ickbDepositCellFrom(deposit, this.script);
    }
  }

  private assertReceiptForCompletion(receipt: ReceiptCell): void {
    const outPoint = receipt.cell.outPoint.toHex();
    if (!this.isReceipt(receipt.cell)) {
      throw new Error(`Receipt ${outPoint} is not an iCKB receipt for this logic script`);
    }
    if (receipt.header.txHash !== receipt.cell.outPoint.txHash) {
      throw new Error(
        `Receipt ${outPoint} header txHash ${String(receipt.header.txHash)} does not match cell txHash ${receipt.cell.outPoint.txHash}`,
      );
    }
  }

  private assertReceiptInputsUnspent(tx: ccc.Transaction, receipts: ReceiptCell[]): void {
    const spent = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
    const selected = new Set<string>();
    for (const receipt of receipts) {
      const outPoint = receipt.cell.outPoint.toHex();
      if (selected.has(outPoint)) {
        throw new Error(`Receipt ${outPoint} is duplicated`);
      }
      selected.add(outPoint);
      if (spent.has(outPoint)) {
        throw new Error(`Receipt ${outPoint} is already being spent`);
      }
    }
  }
}

/**
 * Returns the CKB needed for the two phase-2 outputs created by one receipt.
 *
 * @remarks The value is sized with the actual user lock because lock args affect
 * occupied capacity. It includes one plain output, one xUDT output, and the
 * phase-2 fee reserve.
 *
 * @public
 */
export function receiptPhase2Capacity(lock: ccc.Script): ccc.FixedPoint {
  // Capacity is measured with the actual user lock. Lock args are wallet-specific
  // and can make both phase-2 outputs larger than protocol-only examples.
  const plainCellCapacity = BigInt(8 + lock.occupiedSize) * ccc.One;
  return plainCellCapacity + IckbUdt.minimumXudtCellCapacity(lock) + phase2TxFeeReserve;
}
