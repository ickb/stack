import type { ccc } from "@ckb-ccc/core";

/** The counts a journal line records about a transaction. */
export function transactionShape(tx: ccc.Transaction): {
  inputs: number;
  outputs: number;
  cellDeps: number;
  headerDeps: number;
  witnesses: number;
} {
  return {
    inputs: tx.inputs.length,
    outputs: tx.outputs.length,
    cellDeps: tx.cellDeps.length,
    headerDeps: tx.headerDeps.length,
    witnesses: tx.witnesses.length,
  };
}
