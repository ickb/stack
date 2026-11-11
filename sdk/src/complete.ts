import { ccc } from "@ckb-ccc/core";
import { ICKB_UDT, ickbDepGroup } from "./constants.ts";
import type { State } from "./conversion/types.ts";
import { exceedsDaoOutputLimit, pushHeaderDep } from "./dao.ts";
import { addChange, inputBalance, type ProtocolCell } from "./udt.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/** Why a completion failed: an expected outcome the caller has its own next step for. */
export type CompletionFailure =
  | { ok: false; reason: "insufficient-ickb" }
  | { ok: false; reason: "insufficient-capacity"; cause: unknown }
  | { ok: false; reason: "dao-output-limit" };

/** A completed transaction, or why it could not be completed. */
export type CompleteTransactionResult =
  ({ ok: true } & CompletedTransaction) | CompletionFailure;

/** A completed transaction and the fee its completion planned. */
export interface CompletedTransaction {
  tx: ccc.Transaction;

  /**
   * The fee completion priced, `tx.estimateFee(feeRate)`, which CCC's fee completion meets
   * exactly: the limit `signAndSendTransaction` checks the verified fee against.
   */
  plannedFee: bigint;
}

/**
 * Completes iCKB inputs, iCKB change, plain change, and the fee from the cells it is given.
 *
 * @remarks Completion never scans, and adds no input it is not offered: it spends every
 * one of the state's `cells`, the liquid cells the projection offers this transaction
 * within its input shares, so every own transaction compacts that share of the account,
 * and funds the outputs and the fee from them. Ordinary change is always a plain cell; existing outputs
 * are never reinterpreted or resized as fee change. This does not sign or send.
 * The iCKB dep group is the one of the chain whose genesis header the signer's client
 * serves, read with its hash checked; another chain's genesis throws "unsupported network".
 * Too few iCKB, too little CKB for the cells and the fee, and more outputs than the DAO
 * script accepts are failure values; an input spent twice throws.
 *
 * `state` is the read the plan was priced at: its fee rate prices the fee, its receipts and
 * pool deposits, valued there, are the ones the transaction may spend, and its tip is named
 * as a header dep: the chain refuses a transaction whose deps are off the main chain, so a
 * header a node invented, whose DAO rate set the exchange ratio, cannot price an accepted
 * transaction.
 */
export async function completeTransaction(
  txLike: ccc.TransactionLike,
  { signer, state }: { signer: ccc.Signer; state: State },
): Promise<CompleteTransactionResult> {
  const { feeRate, changeLock } = state;
  const tx = ccc.Transaction.from(txLike).clone();
  // The signer's chain picks the dep group: its genesis, checked against its own hash.
  const genesis = await verifiedClient(signer.client).getHeaderByNumber(0n);
  if (genesis === undefined) {
    throw new Error("Missing genesis header");
  }
  tx.addCellDeps(ickbDepGroup(genesis.hash));
  // Inputs come from one state read, each cell once, and each action spends its own
  // cell kind, so a repeated out point is a builder bug: this is the one place that
  // names it, the node would refuse the transaction anyway.
  const spent = new Set<string>();
  for (const { previousOutput } of tx.inputs) {
    const key = previousOutput.toHex();
    if (spent.has(key)) {
      throw new Error(`Input ${key} is spent twice`);
    }
    spent.add(key);
  }
  for (const cell of state.cells) {
    if (!spent.has(cell.outPoint.toHex())) {
      tx.addInput(cell);
    }
  }
  const ickb = await completeIckb(
    tx,
    signer.client,
    changeLock,
    // Only the spent ones are summed, so every receipt and pool deposit can be offered.
    [...state.receipts, ...state.poolDeposits],
  );
  if (!ickb.ok) {
    return ickb;
  }
  // Last of the header deps, so no index another step names shifts, and before the fee so
  // its 32 bytes are paid for.
  pushHeaderDep(tx, state.tip.hash);
  const fee = await completeFee(tx, signer, changeLock, feeRate);
  if (!fee.ok) {
    return fee;
  }
  if (exceedsDaoOutputLimit(tx)) {
    return { ok: false, reason: "dao-output-limit" };
  }
  return { ok: true, tx, plannedFee: tx.estimateFee(feeRate) };
}

/** iCKB: the inputs, every offered iCKB cell among them, must cover the outputs; then change. */
async function completeIckb(
  tx: ccc.Transaction,
  client: ccc.Client,
  changeLock: ccc.Script,
  protocolCells: readonly ProtocolCell[],
): Promise<{ ok: true } | { ok: false; reason: "insufficient-ickb" }> {
  const required = tx.getOutputsUdtBalance(ICKB_UDT);
  const balance = await inputBalance(tx, client, protocolCells);
  if (balance < required) {
    return { ok: false, reason: "insufficient-ickb" };
  }
  addChange(tx, changeLock, balance - required);
  return { ok: true };
}

/** Completes the fee from the inputs already in, adding none. */
async function completeFee(
  tx: ccc.Transaction,
  signer: ccc.Signer,
  changeLock: ccc.Script,
  feeRate: ccc.Num,
): Promise<
  { ok: true } | { ok: false; reason: "insufficient-capacity"; cause: unknown }
> {
  try {
    await tx.completeFeeChangeToLock(signer, changeLock, feeRate, undefined, {
      shouldAddInputs: false,
    });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof ccc.ErrorTransactionInsufficientCapacity)) {
      throw error;
    }
    return { ok: false, reason: "insufficient-capacity", cause: error };
  }
}

/**
 * Completes the first candidate that the real completer can fund.
 *
 * @remarks
 * Only completion knows what a transaction costs once markers, remainder orders, change, and
 * fee are in, so no count is computed up front: each candidate is built and completed in turn.
 * A completion failure, a shortfall or the DAO output limit, moves on to the next candidate;
 * whatever the build or completion throws propagates. With every candidate failed, the last
 * failure is returned; with no candidate at all, it throws.
 */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction,
  complete: (tx: ccc.Transaction) => Promise<CompleteTransactionResult>,
): Promise<(CompletedTransaction & { ok: true; candidate: T }) | CompletionFailure> {
  let failure: CompletionFailure | undefined;
  for (const candidate of candidates) {
    const done = await complete(build(candidate));
    if (done.ok) {
      return { ...done, candidate };
    }
    failure = done;
  }
  if (failure === undefined) {
    throw new Error("No candidate could be completed");
  }
  return failure;
}
