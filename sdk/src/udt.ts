import { ccc } from "@ckb-ccc/core";
import { DAO, ICKB_LOGIC, ICKB_UDT } from "./constants.ts";
import { isDaoDeposit } from "./dao.ts";
import { Ratio } from "./order/ratio.ts";
import { CheckedUint128LE } from "./utils/codec.ts";
import type { ExchangeRatio } from "./utils/utils.ts";

const ickbXudtTypeOccupiedSize = 69;
const udtDataSize = 16;
const AR_0: ccc.Num = 10000000000000000n; // Base scale for CKB
const depositUsedCapacity = ccc.fixedPointFrom(82); // 82n CKB
const depositCapacityDelta = (depositUsedCapacity * AR_0) / ccc.fixedPointFrom(100000);

/**
 * Soft per-deposit iCKB value cap used before applying the excess discount.
 */
export const ICKB_DEPOSIT_CAP = ccc.fixedPointFrom(100000); // 100,000 iCKB

/**
 * Minimum capacity for an iCKB xUDT cell locked by the supplied lock script.
 */
export function minimumXudtCellCapacity(lock: ccc.Script): ccc.FixedPoint {
  return BigInt(8 + lock.occupiedSize + ickbXudtTypeOccupiedSize + udtDataSize) * ccc.One;
}

/**
 * Returns true when a cell carries the iCKB xUDT type and enough UDT data.
 */
export function isUdt(cellLike: ccc.CellAnyLike): boolean {
  const cell = ccc.CellAny.from(cellLike);
  return (
    cell.cellOutput.type?.eq(ICKB_UDT) === true &&
    ccc.bytesFrom(cell.outputData).length >= udtDataSize
  );
}

/**
 * iCKB carried by the transaction's inputs: xUDT balances plus receipt value, minus the
 * first-phase deposits it re-mints. Receipts and deposits take the value the state read
 * gave them at their deposit headers; a protocol input missing from `protocolCells` is
 * a builder bug and throws, since iCKB Logic would refuse whatever it was valued at.
 */
export async function inputBalance(
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
    if (isUdt(cell)) {
      balance += ccc.udtBalanceFrom(cell.outputData);
      continue;
    }
    const sign = protocolSign(cell);
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
function protocolSign(cell: ccc.Cell): bigint {
  const { type, lock } = cell.cellOutput;
  if (type !== undefined && ICKB_LOGIC.eq(type)) {
    return 1n;
  }
  return ICKB_LOGIC.eq(lock) && isDaoDeposit(cell, DAO) ? -1n : 0n;
}

/** Adds the iCKB change output when the surplus is positive; zero needs no output. */
export function addChange(
  tx: ccc.Transaction,
  lock: ccc.ScriptLike,
  balance: ccc.Num,
): void {
  if (balance <= ccc.Zero) {
    return;
  }
  tx.addOutput({ lock, type: ICKB_UDT }, CheckedUint128LE.encode(balance));
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
  // Stryker disable next-line EqualityOperator: at exactly the cap the excess is zero, so the discount subtracts nothing either way.
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

/** The free-capacity accounting ratio at a block header's DAO accumulated rate. */
export function ickbAccountingRatio(header: ccc.ClientBlockHeader): ExchangeRatio {
  return {
    ckbScale: AR_0,
    udtScale: header.dao.ar,
  };
}

/**
 * The CKB-to-iCKB exchange ratio at `header`, for a recoverable standard deposit.
 *
 * @remarks Includes the standard deposit's 82 CKB occupied capacity spread
 * over the 100,000 iCKB reference amount.
 */
export function exchangeRatioAt(header: ccc.ClientBlockHeader): Ratio {
  return Ratio.from({
    ckbScale: AR_0,
    udtScale: header.dao.ar + depositCapacityDelta,
  });
}

/** A receipt or iCKB deposit with the iCKB value the state read gave it. */
export interface ProtocolCell {
  cell: ccc.Cell;
  udtValue: ccc.Num;
}
