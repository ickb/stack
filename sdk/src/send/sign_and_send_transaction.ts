import type { ccc } from "@ckb-ccc/core";
import type { BroadcastDeadline } from "../dao.ts";
import { commitTransaction, type CommitStep } from "./commit_transaction.ts";

/**
 * A send's outcome. `not-signed`: the signer refused or failed to sign, its rejection the
 * `cause`. `expired`: the chain reached the broadcast deadline; nothing was sent.
 * `maybe-sent`: the broadcast failed without saying whether the node took the transaction,
 * so `txHash` is the one to watch, never to resend.
 */
export type SignAndSendTransactionResult =
  | { ok: true; txHash: ccc.Hex }
  | { ok: false; reason: "not-signed"; cause: unknown }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "maybe-sent"; txHash: ccc.Hex; cause: unknown };

/**
 * The first step of {@link commitTransaction}: its checks, signature and first broadcast.
 * A node already holding this exact transaction is an acceptance; any other send failure
 * returns `maybe-sent` with the hash, for a send that may never answer.
 */
export async function signAndSendTransaction(
  signer: ccc.Signer,
  built: {
    tx: ccc.TransactionLike;
    plannedFee: ccc.Num;
    broadcastBefore?: BroadcastDeadline;
  },
): Promise<SignAndSendTransactionResult> {
  // The commit is lazy: left at its first step, it reads nothing more.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, no-restricted-syntax -- a commit yields a step or throws before it can end.
  const step = (await commitTransaction(signer, built).next()).value as CommitStep;
  const { txHash, cause } = step;
  if (step.ok) {
    return cause === undefined
      ? { ok: true, txHash }
      : { ok: false, reason: "maybe-sent", txHash, cause };
  }
  return step.reason === "not-signed"
    ? { ok: false, reason: "not-signed", cause }
    : { ok: false, reason: "expired" };
}
