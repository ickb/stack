import { ccc } from "@ckb-ccc/core";
import { committedTransactionResponse } from "@ickb/testkit";

export type TransactionResponse = Awaited<ReturnType<ccc.Client["getTransaction"]>>;

export function transactionResponse(
  blockNumber: bigint | undefined,
): TransactionResponse {
  return blockNumber === undefined
    ? undefined
    : committedTransactionResponse(ccc.Transaction.default(), { blockNumber });
}
