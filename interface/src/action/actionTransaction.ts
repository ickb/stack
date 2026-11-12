import { ickb } from "@ickb/sdk";
import { l1StateQueryKey, type L1StateType } from "../app/queries.ts";
import { errorMessageOf, type SendableTx, type WalletConfig } from "../shared/utils.ts";
import { confirmPreviewMessage } from "./actionStatus.ts";

const expiredMessage =
  "The withdrawal timing changed while you were signing. Nothing was sent. Review the refreshed preview and sign again.";

/** The fresh state a send was built from, with the transaction it built. */
export type RefreshedTransactionPreview = L1StateType & { readonly txInfo: SendableTx };

/** Where the session's attempt is: none, building its preview, or signing and committing. */
export type AttemptPhase = "idle" | "preparing" | "confirming";

/** What the session's attempt shows, owned by the wallet session, not by a view. */
export interface AttemptState {
  readonly phase: AttemptPhase;
  readonly message: string;
  readonly failure: string;
  readonly frozenPreview: RefreshedTransactionPreview | undefined;
}

export interface TransactionCallbacks {
  readonly freezePreview: (preview: RefreshedTransactionPreview | undefined) => void;
  readonly setMessage: (message: string) => void;
  readonly setFailure: (message: string) => void;
  readonly setPhase: (phase: AttemptPhase) => void;
  readonly formReset: () => void;
  readonly walletConfig: WalletConfig;
}

interface TransactParams extends TransactionCallbacks {
  readonly refreshState: () => Promise<L1StateType>;
  readonly isCkb2Udt: boolean;
  readonly amount: bigint;
  readonly yieldForPreview?: () => Promise<void>;
}

/**
 * Builds the conversion from fresh state, then commits it to its last step, as a bank
 * transfer holds the screen until it settles: nothing stops it, a reload is the only escape.
 */
export async function transact({
  refreshState,
  isCkb2Udt,
  amount,
  yieldForPreview = yieldForPreviewRender,
  ...callbacks
}: TransactParams): Promise<void> {
  try {
    callbacks.setFailure("");
    callbacks.setPhase("preparing");
    callbacks.setMessage("Refreshing transaction preview...");
    const state = await refreshState();
    const txInfo = await state.txBuilder(isCkb2Udt, amount);
    if (!txInfo.ok) {
      throw new Error(txInfo.error);
    }
    const preview = { ...state, txInfo };
    callbacks.freezePreview(preview);
    callbacks.setMessage(confirmPreviewMessage(preview));
    await yieldForPreview();
    callbacks.setPhase("confirming");
    for await (const step of ickb.commitTransaction(
      callbacks.walletConfig.signer,
      txInfo,
    )) {
      if (step.ok && step.status === "committed") {
        await completeConfirmedTransaction(callbacks);
      } else if (step.ok) {
        callbacks.setMessage(waitingMessage(step.status, step));
      } else if (step.reason === "not-signed") {
        // Declining is the user's choice, not a failure: the draft returns as it was.
        callbacks.freezePreview(undefined);
      } else {
        // The preview is released and the next one rebuilds from a fresh state read.
        callbacks.setFailure(failureMessage(step.reason, step));
        callbacks.freezePreview(undefined);
      }
    }
  } catch (error) {
    // Nothing was sent: the SDK throws only before the broadcast. The failure shows in the
    // message's place until the next attempt sets both.
    callbacks.setFailure(errorMessageOf(error));
    callbacks.freezePreview(undefined);
  } finally {
    callbacks.setPhase("idle");
  }
}

// A task, not a microtask: React commits the frozen preview in a scheduled task. When every
// read before the signature answers from cache, the commit could otherwise open the wallet
// over the live preview.
async function yieldForPreviewRender(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * A sent or pending step. On `sent` a cause is what the first send got instead of a clear
 * acceptance, which the next step settles; on `pending` it failed and is retried.
 */
function waitingMessage(
  status: "sent" | "pending" | "committed",
  { txHash, cause }: ickb.CommitStep,
): string {
  const waiting = `Transaction ${txHash} sent. Waiting for network confirmation...`;
  if (cause === undefined) {
    return waiting;
  }
  const label = status === "sent" ? "First send" : "Retrying";
  return `${waiting} ${label}: ${errorMessageOf(cause)}`;
}

function failureMessage(
  reason: "expired" | "abandoned" | "rejected",
  { txHash, cause }: ickb.CommitStep,
): string {
  return {
    expired: expiredMessage,
    abandoned: `The withdrawal deadline passed before the network took the transaction, so it is no longer sent. An earlier copy may still land. Hash: ${txHash}`,
    rejected: `Transaction rejected: ${cause?.message ?? "the node gave no reason"}. Hash: ${txHash}`,
  }[reason];
}

async function completeConfirmedTransaction({
  freezePreview,
  formReset,
  setMessage,
  walletConfig,
}: TransactionCallbacks): Promise<void> {
  setMessage("Transaction confirmed.");
  await walletConfig.queryClient.invalidateQueries({
    queryKey: l1StateQueryKey(walletConfig),
    exact: true,
  });
  formReset();
  freezePreview(undefined);
  setMessage("");
}
