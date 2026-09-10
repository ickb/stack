import { ccc } from "@ckb-ccc/core";
import { isIckbError } from "../client/sdk_error.ts";
import { DaoOutputLimitError } from "../dao/index.ts";
import { OrderConversionRepresentabilityError } from "../order/index.ts";

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
 * transport, scan, signer, and malformed-transaction errors propagate. `accept` rejects a
 * completed transaction on policy grounds, which also advances the walk.
 *
 * Without `accept`, exhausting the candidates throws the last advancing failure, since the
 * caller has no policy of its own to fall back on; with `accept`, exhaustion returns
 * `undefined` and the caller decides.
 *
 * @public
 */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction | undefined,
  complete: (tx: ccc.Transaction) => Promise<ccc.Transaction>,
): Promise<FundableCompletion<T>>;
/** With `accept`: exhaustion returns `undefined` and the caller decides. @public */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction | undefined,
  complete: (tx: ccc.Transaction) => Promise<ccc.Transaction>,
  accept: (tx: ccc.Transaction, candidate: T) => boolean,
): Promise<FundableCompletion<T> | undefined>;
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction | undefined,
  complete: (tx: ccc.Transaction) => Promise<ccc.Transaction>,
  accept?: (tx: ccc.Transaction, candidate: T) => boolean,
): Promise<FundableCompletion<T> | undefined> {
  let error: Error | undefined;
  for (const candidate of candidates) {
    let tx: ccc.Transaction;
    try {
      const partial = build(candidate);
      if (partial === undefined) {
        continue;
      }
      tx = await complete(partial);
    } catch (failure) {
      if (!isFundabilityFailure(failure)) {
        throw failure;
      }
      error = failure;
      continue;
    }
    if (accept === undefined || accept(tx, candidate)) {
      return { candidate, tx };
    }
  }
  if (accept === undefined) {
    throw error ?? new Error("No candidate could be completed");
  }
  return undefined;
}

function isFundabilityFailure(error: unknown): error is Error {
  return (
    isIckbError(error) ||
    error instanceof ccc.ErrorTransactionInsufficientCapacity ||
    error instanceof DaoOutputLimitError ||
    error instanceof OrderConversionRepresentabilityError
  );
}
