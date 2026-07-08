import { ccc } from "@ckb-ccc/core";

/**
 * Maximum output count accepted by the Nervos DAO validator path.
 *
 * @public
 */
export const DAO_OUTPUT_LIMIT = 64;

/**
 * Throws when a transaction exceeds the Nervos DAO output limit.
 *
 * @public
 */
export async function assertDaoOutputLimit(
  txLike: ccc.TransactionLike | ccc.Transaction,
  client: ccc.Client,
): Promise<void> {
  const tx = ccc.Transaction.from(txLike);
  if (await ccc.isDaoOutputLimitExceeded(tx, client)) {
    throw new DaoOutputLimitError(tx.outputs.length);
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
