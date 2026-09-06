import { ccc } from "@ckb-ccc/core";

/**
 * Maximum output count accepted by the Nervos DAO validator path.
 *
 * @public
 */
export const DAO_OUTPUT_LIMIT = 64;

/**
 * Throws when a completed transaction using the configured DAO script exceeds
 * the Nervos DAO output limit.
 *
 * @public
 */
export function assertDaoOutputLimit(
  txLike: ccc.TransactionLike | ccc.Transaction,
  daoScriptLike: ccc.ScriptLike,
): void {
  const tx = ccc.Transaction.from(txLike);
  if (tx.outputs.length <= DAO_OUTPUT_LIMIT) {
    return;
  }

  const daoScript = ccc.Script.from(daoScriptLike);
  const usesDao =
    tx.inputs.some((input) => input.cellOutput?.type?.eq(daoScript) === true) ||
    tx.outputs.some((output) => output.type?.eq(daoScript) === true);
  if (usesDao) {
    throw new DaoOutputLimitError(tx.outputs.length);
  }
  if (tx.inputs.some((input) => input.cellOutput === undefined)) {
    throw new DaoOutputLimitIndeterminateError(tx.outputs.length);
  }
}

/**
 * Error thrown when a DAO transaction exceeds the protocol output limit.
 *
 * @public
 */
export class DaoOutputLimitError extends Error {
  /**
   * Creates an output-limit error for a transaction with too many outputs.
   */
  constructor(outputCount: number, options?: ErrorOptions) {
    super(
      `NervosDAO transaction has ${String(outputCount)} output cells, exceeding the limit of ${String(DAO_OUTPUT_LIMIT)}`,
      options,
    );
    this.name = "DaoOutputLimitError";
  }
}

/**
 * Error thrown when unresolved inputs prevent a safe DAO output-limit check.
 *
 * @public
 */
export class DaoOutputLimitIndeterminateError extends Error {
  /**
   * Creates an indeterminate output-limit error for an oversized transaction.
   */
  constructor(outputCount: number, options?: ErrorOptions) {
    super(
      `Cannot determine whether transaction with ${String(outputCount)} output cells uses NervosDAO because an input cell output is unresolved`,
      options,
    );
    this.name = "DaoOutputLimitIndeterminateError";
  }
}
