import { ccc } from "@ckb-ccc/core";
import { DaoOutputLimitError } from "../core/index.ts";
import { OrderConversionRepresentabilityError } from "../order/index.ts";
import { isIckbError } from "./sdk_error.ts";

/**
 * One attempt of a completion walk: the candidate it was built from and the completed transaction.
 *
 * @public
 */
export interface FundableCompletion<T> {
  candidate: T;
  tx: ccc.Transaction;
}

/**
 * Completes the first candidate that the real completer can fund.
 *
 * @remarks
 * Only completion knows what a transaction costs once markers, remainder orders, change, and
 * fee are in, so no count is computed up front: each candidate is built and completed in turn
 * (decisions amendment 41). A builder returning `undefined` skips a candidate it cannot
 * represent. Capacity, DAO output-limit, and representability failures advance the walk;
 * transport, scan, signer, and malformed-transaction errors propagate. Exhausting the
 * candidates throws the last advancing failure.
 *
 * @public
 */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction | undefined,
  complete: (tx: ccc.Transaction) => Promise<ccc.Transaction>,
): Promise<FundableCompletion<T>> {
  let error: Error | undefined;
  for (const candidate of candidates) {
    try {
      const partial = build(candidate);
      if (partial === undefined) {
        continue;
      }
      return { candidate, tx: await complete(partial) };
    } catch (failure) {
      if (!isFundabilityFailure(failure)) {
        throw failure;
      }
      error = failure;
    }
  }
  throw error ?? new Error("No candidate could be completed");
}

/** A failure the walk advances past: the candidate costs more than the account funds. */
export function isFundabilityFailure(error: unknown): error is Error {
  return (
    isIckbError(error) ||
    error instanceof ccc.ErrorTransactionInsufficientCapacity ||
    error instanceof DaoOutputLimitError ||
    error instanceof OrderConversionRepresentabilityError
  );
}
