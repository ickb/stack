import type { ccc } from "@ckb-ccc/core";
import { unique } from "@ickb/utils";

/**
 * Returns the primary lock plus all signer address locks, deduplicated by script hash.
 */
export async function signerAccountLocks(
  signer: ccc.Signer,
  primaryLock: ccc.Script,
): Promise<ccc.Script[]> {
  return [
    ...unique([
      primaryLock,
      ...(await signer.getAddressObjs()).map(({ script }) => script),
    ]),
  ];
}

/**
 * Sums currently live plain CKB capacity controlled by the account locks.
 */
export function accountPlainCkbBalance(
  capacityCells: readonly ccc.Cell[],
  accountLocks: readonly ccc.Script[],
): bigint {
  const accountLockHexes = new Set(accountLocks.map((lock) => lock.toHex()));
  return capacityCells.reduce(
    (total, cell) =>
      total + plainCapacity(cell.cellOutput, cell.outputData, accountLockHexes),
    0n,
  );
}

/**
 * Projects account plain CKB capacity after applying a transaction's inputs and outputs.
 */
export function postTransactionAccountPlainCkbBalance(
  tx: ccc.Transaction,
  capacityCells: readonly ccc.Cell[],
  accountLocks: readonly ccc.Script[],
): bigint {
  if (tx.outputs.length !== tx.outputsData.length) {
    throw new Error(
      `Malformed transaction: outputs count ${String(tx.outputs.length)} differs from outputsData count ${String(tx.outputsData.length)}`,
    );
  }

  const accountLockHexes = new Set(accountLocks.map((lock) => lock.toHex()));
  const spentOutPoints = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  const unspentCapacity = capacityCells.reduce(
    (total, cell) =>
      spentOutPoints.has(cell.outPoint.toHex())
        ? total
        : total + plainCapacity(cell.cellOutput, cell.outputData, accountLockHexes),
    0n,
  );
  const outputCapacity = tx.outputs.reduce((total, output, index) => {
    const outputData = tx.outputsData[index];
    if (outputData === undefined) {
      throw new Error("Malformed transaction: missing output data");
    }
    return total + plainCapacity(output, outputData, accountLockHexes);
  }, 0n);

  return unspentCapacity + outputCapacity;
}

function plainCapacity(
  output: ccc.CellOutput,
  outputData: string,
  accountLockHexes: Set<string>,
): bigint {
  return isAccountPlainCapacityOutput(output, outputData, accountLockHexes)
    ? output.capacity
    : 0n;
}

function isAccountPlainCapacityOutput(
  output: ccc.CellOutput,
  outputData: string,
  accountLockHexes: Set<string>,
): boolean {
  return (
    output.type === undefined &&
    outputData === "0x" &&
    accountLockHexes.has(output.lock.toHex())
  );
}
