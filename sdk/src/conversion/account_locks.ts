import type { ccc } from "@ckb-ccc/core";
import { unique } from "../utils/index.ts";

/**
 * Returns the primary lock plus all signer address locks, deduplicated by script hash.
 *
 * @public
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
 *
 * @public
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
