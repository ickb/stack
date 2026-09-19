import { ccc } from "@ckb-ccc/core";
import { DaoHeaderIndexError, DaoOutputLimitError } from "../core/index.ts";
import { IckbError } from "./error.ts";

/**
 * Completes the first candidate that the real completer can fund.
 *
 * @remarks
 * Only completion knows what a transaction costs once markers, remainder orders, change, and
 * fee are in, so no count is computed up front: each candidate is built and completed in turn
 * (decisions amendment 41). Capacity, DAO output-limit and DAO header-index failures advance
 * the walk; transport, scan, signer, and malformed-transaction errors propagate. Exhausting
 * the candidates throws the last advancing failure.
 */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction,
  complete: (tx: ccc.Transaction) => Promise<ccc.Transaction>,
): Promise<{ candidate: T; tx: ccc.Transaction }> {
  let error: Error | undefined;
  for (const candidate of candidates) {
    try {
      return { candidate, tx: await complete(build(candidate)) };
    } catch (failure) {
      if (!isFundabilityFailure(failure)) {
        throw failure;
      }
      error = failure;
    }
  }
  throw error ?? new Error("No candidate could be completed");
}

/**
 * A failure the walk advances past: the candidate costs more than the account funds, or
 * needs more DAO outputs or deposit-header slots than one transaction has.
 */
export function isFundabilityFailure(error: unknown): error is Error {
  return (
    error instanceof IckbError ||
    error instanceof ccc.ErrorTransactionInsufficientCapacity ||
    error instanceof DaoOutputLimitError ||
    error instanceof DaoHeaderIndexError
  );
}
