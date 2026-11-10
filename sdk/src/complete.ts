import { ccc } from "@ckb-ccc/core";
import { DAO, ICKB_UDT, ickbDepGroup } from "./constants.ts";
import type { SystemState } from "./conversion/types.ts";
import { assertDaoOutputLimit, DaoOutputLimitError, pushHeaderDep } from "./dao.ts";
import type { ReceiptCell } from "./logic.ts";
import { addChange, inputBalance, isUdt, type ProtocolCell } from "./udt.ts";
import { compareBigInt, isPlainCapacityCell } from "./utils/utils.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/**
 * Options for completing a partial iCKB transaction before signing and sending.
 */
export interface CompleteIckbTransactionOptions {
  /** Signer that prepares the transaction; its recommended lock owns the change. */
  signer: ccc.Signer;

  /**
   * The state read the plan was priced at. Its fee rate prices the fee; its pool deposits,
   * valued there, are the ones a withdrawal request may spend; its tip is named as a header
   * dep: the chain refuses a transaction whose deps are off the main chain, so a header a
   * node invented, whose DAO rate set the exchange ratio, cannot price an accepted
   * transaction.
   */
  system: SystemState;

  /** The receipts the transaction may spend, valued by the state read. */
  receipts: readonly ReceiptCell[];

  /** The signer's known liquid cells, plain CKB and iCKB, from the account state already read. */
  cells: readonly ccc.Cell[];
}

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
 * Input count up to which one own transaction sweeps liquid cells.
 *
 * @remarks A compaction target, not a validity bound: required funding and the fee may go
 * past it. Counted rather than measured in bytes because a same-lock input costs a fixed
 * 44 bytes (52 with an extra witness slot), so 1,000 inputs stay near 50 KB, far under the
 * node's 512,000-byte limit, and near the one measured point (1,000 inputs: 44 KB, about
 * 180 ms of local completion). A larger backlog takes several transactions.
 */
export const SWEEP_INPUT_LIMIT = 1000;

/**
 * Completes iCKB inputs, iCKB change, plain change, and the fee from the cells it is given.
 *
 * @remarks Completion never scans. `cells` are the signer's known liquid cells, plain
 * CKB and iCKB, from the account state already read: the largest ones fund what the
 * outputs need, the rest ride along as a sweep while the transaction has fewer than
 * {@link SWEEP_INPUT_LIMIT} inputs, so every own transaction compacts the account.
 * Ordinary change is always a plain cell; existing outputs
 * are never reinterpreted or resized as fee change. This does not sign or send.
 * The iCKB dep group is the one of the chain whose genesis header the signer's client
 * serves, read with its hash checked; another chain's genesis throws "unsupported network".
 */
export async function completeTransaction(
  txLike: ccc.TransactionLike,
  options: CompleteIckbTransactionOptions,
): Promise<CompletedTransaction> {
  const { signer, system } = options;
  const { feeRate } = system;
  const tx = ccc.Transaction.from(txLike).clone();
  // The signer's chain picks the dep group: its genesis, checked against its own hash.
  const genesis = await verifiedClient(signer.client).getHeaderByNumber(0n);
  if (genesis === undefined) {
    throw new Error("Missing genesis header");
  }
  tx.addCellDeps(ickbDepGroup(genesis.hash));
  const changeLock = (await signer.getRecommendedAddressObj()).script;
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
  const unspent = options.cells.filter((cell) => !spent.has(cell.outPoint.toHex()));
  const ickbCells = unspent
    .filter((cell) => isUdt(cell))
    .toSorted((left, right) => compareBigInt(udtBalance(right), udtBalance(left)));
  const plainCells = unspent
    .filter(isPlainCapacityCell)
    .toSorted((left, right) =>
      compareBigInt(right.cellOutput.capacity, left.cellOutput.capacity),
    );

  await completeIckb(
    tx,
    signer.client,
    changeLock,
    ickbCells,
    // Only the spent ones are summed, so every receipt and pool deposit can be offered.
    [...options.receipts, ...system.poolDeposits],
  );
  // Plain CKB: the sweep first, then whatever the fee still needs beyond the limit.
  const swept = sweep(tx, plainCells);
  // Last of the header deps, so no index another step names shifts, and before the fee so
  // its 32 bytes are paid for.
  pushHeaderDep(tx, system.tip.hash);
  await completeFee(tx, signer, changeLock, feeRate, plainCells.slice(swept));
  const plannedFee = tx.estimateFee(feeRate);
  assertDaoOutputLimit(tx, DAO);
  return { tx, plannedFee };
}

/** iCKB: what the outputs need first, then the sweep while the limit allows, then change. */
async function completeIckb(
  tx: ccc.Transaction,
  client: ccc.Client,
  changeLock: ccc.Script,
  ickbCells: readonly ccc.Cell[],
  protocolCells: readonly ProtocolCell[],
): Promise<void> {
  const required = tx.getOutputsUdtBalance(ICKB_UDT);
  let balance = await inputBalance(tx, client, protocolCells);
  for (const cell of ickbCells) {
    if (balance >= required && tx.inputs.length >= SWEEP_INPUT_LIMIT) {
      break;
    }
    tx.addInput(cell);
    balance += udtBalance(cell);
  }
  if (balance < required) {
    throw new IckbError(`Insufficient iCKB, need ${String(required - balance)} more`, {
      code: "insufficient_ickb",
    });
  }
  addChange(tx, changeLock, balance - required);
}

function udtBalance(cell: ccc.Cell): ccc.Num {
  return ccc.udtBalanceFrom(cell.outputData);
}

/** Adds cells while the input count stays under the limit; returns how many were added. */
function sweep(tx: ccc.Transaction, cells: readonly ccc.Cell[]): number {
  const added = Math.min(cells.length, Math.max(0, SWEEP_INPUT_LIMIT - tx.inputs.length));
  for (const cell of cells.slice(0, added)) {
    tx.addInput(cell);
  }
  return added;
}

/** Completes the fee, adding reserve cells one at a time while capacity is short. */
async function completeFee(
  tx: ccc.Transaction,
  signer: ccc.Signer,
  changeLock: ccc.Script,
  feeRate: ccc.Num,
  reserve: readonly ccc.Cell[],
): Promise<void> {
  const remaining = [...reserve];
  for (;;) {
    try {
      await tx.completeFeeChangeToLock(signer, changeLock, feeRate, undefined, {
        shouldAddInputs: false,
      });
      return;
    } catch (error) {
      if (!(error instanceof ccc.ErrorTransactionInsufficientCapacity)) {
        throw error;
      }
      const cell = remaining.shift();
      if (cell === undefined) {
        throw new IckbError(error.message, {
          code: "insufficient_capacity",
          cause: error,
        });
      }
      tx.addInput(cell);
    }
  }
}

/** Stable machine-readable SDK failures. */
export type IckbErrorCode = "insufficient_capacity" | "insufficient_ickb";

/** Typed SDK failure with a stable machine-readable code. */
export class IckbError extends Error {
  /** Stable failure code for callers and observability. */
  public readonly code: IckbErrorCode;

  /** Creates a typed SDK failure while preserving its cause. */
  constructor(message: string, options: ErrorOptions & { code: IckbErrorCode }) {
    super(message, options);
    this.name = "IckbError";
    this.code = options.code;
  }
}

/**
 * Completes the first candidate that the real completer can fund.
 *
 * @remarks
 * Only completion knows what a transaction costs once markers, remainder orders, change, and
 * fee are in, so no count is computed up front: each candidate is built and completed in turn.
 * Capacity and DAO output-limit failures advance
 * the walk; transport, scan, signer, and malformed-transaction errors propagate. Exhausting
 * the candidates throws the last advancing failure.
 */
export async function completeFirstFundable<T>(
  candidates: Iterable<T>,
  build: (candidate: T) => ccc.Transaction,
  complete: (tx: ccc.Transaction) => Promise<CompletedTransaction>,
): Promise<CompletedTransaction & { candidate: T }> {
  let error: Error | undefined;
  for (const candidate of candidates) {
    try {
      return { candidate, ...(await complete(build(candidate))) };
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
 * needs more DAO outputs than one transaction has.
 */
export function isFundabilityFailure(error: unknown): error is Error {
  return (
    error instanceof IckbError ||
    error instanceof ccc.ErrorTransactionInsufficientCapacity ||
    error instanceof DaoOutputLimitError
  );
}
