import { ccc, mol } from "@ckb-ccc/core";
import { DAO, ICKB_LOGIC } from "./constants.ts";
import {
  DAO_DEPOSIT_DATA,
  depositMaturity,
  isDaoDeposit,
  pushHeaderDep,
  type LockUpPolicy,
} from "./dao.ts";
import { ickbValue, minimumXudtCellCapacity } from "./udt.ts";
import { CheckedUint32LE, CheckedUint64LE } from "./utils/codec.ts";
import {
  findCells,
  headersByNumber,
  type ScannedCell,
  type ValueComponents,
} from "./utils/utils.ts";

// A receipt's fixed prefix: 4 bytes of deposit quantity and 8 of deposit amount.
const receiptDataBytes = 12;

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

// Receipts must carry enough capacity for phase 2 when the wallet has no other
// CKB: one iCKB xUDT cell, one plain capacity cell, and the fee reserve.
const phase2TxFeeReserve = ccc.One;

/**
 * A live iCKB deposit: a DAO deposit cell locked by the iCKB Logic script, valued at its
 * deposit header.
 */
export interface DepositCell extends ValueComponents {
  /** The DAO deposit cell. */
  cell: ccc.Cell;
  /** The header of the block that committed the deposit, which values it. */
  header: ccc.ClientBlockHeader;
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
  /** The header of the block that committed the deposits, which values them. */
  header: ccc.ClientBlockHeader;
}

/** Whether the cell is an iCKB receipt: typed by iCKB Logic with a decodable prefix. */
export function isReceipt(cell: ccc.Cell): boolean {
  return (
    cell.cellOutput.type?.eq(ICKB_LOGIC) === true &&
    ccc.bytesFrom(cell.outputData).length >= receiptDataBytes
  );
}

/** Whether the cell is a DAO deposit locked by iCKB Logic. */
export function isDeposit(cell: ccc.Cell): boolean {
  return isDaoDeposit(cell, DAO) && cell.cellOutput.lock.eq(ICKB_LOGIC);
}

/**
 * Adds `depositQuantity` DAO deposits of `depositCapacity` locked by iCKB Logic, then the
 * receipt that mints their iCKB in phase 2, locked by `lock`.
 *
 * @remarks Completion (`completeTransaction`) adds the dep group that resolves
 * the iCKB Logic, DAO and xUDT scripts.
 */
export function deposit(
  txLike: ccc.TransactionLike,
  depositQuantity: number,
  depositCapacity: ccc.FixedPoint,
  lock: ccc.Script,
): ccc.Transaction {
  // A zero quantity would mint a receipt for no deposits, which iCKB Logic refuses on chain.
  if (!Number.isSafeInteger(depositQuantity) || depositQuantity <= 0) {
    throw new TypeError("iCKB deposit quantity must be a positive safe integer");
  }
  const tx = ccc.Transaction.from(txLike);

  const depositCell = ccc.CellAny.from({
    cellOutput: { capacity: depositCapacity, lock: ICKB_LOGIC, type: DAO },
    outputData: DAO_DEPOSIT_DATA,
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

  for (let i = 0; i < depositQuantity; i += 1) {
    tx.addOutput(depositCell.cellOutput, depositCell.outputData);
  }
  // Receipts track the deposit's free capacity, not the full DAO cell capacity.
  tx.addOutput(
    { capacity: receiptPhase2Capacity(lock), lock, type: ICKB_LOGIC },
    encodeReceiptData({ depositQuantity: BigInt(depositQuantity), depositAmount }),
  );
  return tx;
}

/**
 * Adds receipt inputs and their deposit header deps for iCKB deposit completion.
 *
 * @remarks This prepares the phase-2 inputs; the iCKB they mint is completed by
 * `completeTransaction`, which also adds the dep group.
 */
export function completeDeposit(
  txLike: ccc.TransactionLike,
  receipts: ReceiptCell[],
): ccc.Transaction {
  const tx = ccc.Transaction.from(txLike);
  for (const receipt of receipts) {
    const outPoint = receipt.cell.outPoint.toHex();
    if (!isReceipt(receipt.cell)) {
      throw new Error(`Receipt ${outPoint} is not an iCKB receipt`);
    }
  }
  for (const receipt of receipts) {
    pushHeaderDep(tx, receipt.header.hash);
    tx.addInput(receipt.cell);
  }
  return tx;
}

/**
 * The receipts among `cells`, valued at their deposit headers, each header read once.
 */
export async function receiptsFrom(
  client: ccc.Client,
  cells: readonly ScannedCell[],
): Promise<ReceiptCell[]> {
  const receipts = cells.filter(({ cell }) => isReceipt(cell));
  const headers = await headersByNumber(
    client,
    receipts.map(({ blockNumber }) => blockNumber),
  );
  return receipts.map(({ cell, blockNumber }) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every receipt's block was read above.
    receiptCell(cell, headers.get(blockNumber)!),
  );
}

/**
 * Every live iCKB deposit, valued at its deposit header, with its claim epoch at the tip;
 * each deposit block's header is read once.
 */
export async function findDeposits(
  client: ccc.Client,
  tip: ccc.ClientBlockHeader,
): Promise<DepositCell[]> {
  const cells = (
    await findCells(client, {
      script: ICKB_LOGIC,
      scriptType: "lock",
      filter: {
        script: DAO,
        outputData: DAO_DEPOSIT_DATA,
        outputDataSearchMode: "exact",
      },
      scriptSearchMode: "exact",
      withData: true,
    })
  ).filter(({ cell }) => isDeposit(cell));
  const headers = await headersByNumber(
    client,
    cells.map(({ blockNumber }) => blockNumber),
  );
  return cells.map(({ cell, blockNumber }) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every deposit's block was read above.
    ickbDepositCell(cell, headers.get(blockNumber)!, tip),
  );
}

/** Values a DAO deposit cell at its deposit header and samples its claim epoch at the tip. */
function ickbDepositCell(
  cell: ccc.Cell,
  header: ccc.ClientBlockHeader,
  tip: ccc.ClientBlockHeader,
): DepositCell {
  const interests = ccc.calcDaoProfit(cell.capacityFree, header, tip);
  return {
    cell,
    header,
    claimEpoch: ccc.calcDaoClaimEpoch(header, tip),
    ckbValue: cell.cellOutput.capacity + interests,
    udtValue: ickbValue(cell.capacityFree, header),
  };
}

/** The deposits a withdrawal request made now may claim at their sampled dates under the policy. */
export function readyDeposits(
  deposits: readonly DepositCell[],
  tip: ccc.ClientBlockHeader,
  policy: LockUpPolicy,
): DepositCell[] {
  return deposits.filter(
    ({ claimEpoch }) => depositMaturity(claimEpoch, tip, policy).isReady,
  );
}

/** Decodes a receipt cell and values it at its deposit header. */
export function receiptCell(cell: ccc.Cell, header: ccc.ClientBlockHeader): ReceiptCell {
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
    udtValue: ickbValue(receipt.depositAmount, header) * receipt.depositQuantity,
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
  return plainCellCapacity + minimumXudtCellCapacity(lock) + phase2TxFeeReserve;
}
