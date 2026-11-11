import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  completeTransaction,
  type CompletionFailure,
} from "./complete.ts";
import { ORDER } from "./constants.ts";
import { minimumOrderAmount } from "./conversion/estimate.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "./conversion/plans.ts";
import type {
  ConversionTransactionOptions,
  ConversionTransactionResult,
  State,
} from "./conversion/types.ts";
import { broadcastDeadline } from "./dao.ts";
import { completeDeposit, deposit, type DepositCell } from "./logic.ts";
import { isCkbToIckb } from "./order/conversion.ts";
import { melt, mint } from "./order/order.ts";
import { requestWithdrawal, withdraw } from "./owned_owner.ts";

/** What every own transaction collects along: the state's collectable positions. */
type CollectSteps = Pick<State, "availableOrders" | "receipts" | "readyWithdrawals">;

/**
 * Builds and completes one conversion transaction from a read state.
 *
 * @remarks
 * Every branch returns a transaction funded from the signer's committed cells: the
 * candidate plans (deposit counts, or prefixes of the greedy withdrawal selection with
 * their rebuilt remainder order) are completed most direct first and the first fundable one
 * wins, so a wallet short of CKB degrades to fewer direct actions plus a larger standing
 * order rather than failing. Failure results are
 * expected planning outcomes; when no plan can be funded the last shortfall is the result,
 * `insufficient-capacity` or `insufficient-ickb`.
 * Misuse throws: a negative amount (`RangeError`), a direction that is neither of the two
 * (`TypeError`), and an amount of zero with nothing to collect, which
 * the state's `hasCollectable` tells a caller beforehand.
 */
export async function buildConversionTransaction(
  options: ConversionTransactionOptions,
): Promise<ConversionTransactionResult> {
  const { amount, state, direction } = options;
  if (amount < 0n) {
    throw new RangeError("Conversion amount is negative");
  }
  // Checked before the collection branch too: a misspelled direction is misuse at any amount.
  const ckbToIckb = isCkbToIckb(direction);
  if (ckbToIckb && amount > state.ckbAvailable) {
    return { ok: false, reason: "insufficient-ckb" };
  }
  if (!ckbToIckb && amount > state.ickbAvailable) {
    return { ok: false, reason: "insufficient-ickb" };
  }
  if (amount === 0n) {
    return buildCollectOnlyConversion(options);
  }
  return buildConversion(options, ckbToIckb);
}

async function buildCollectOnlyConversion(
  options: ConversionTransactionOptions,
): Promise<ConversionTransactionResult> {
  const { state } = options;
  // A transaction that would only compact the account is not worth its fee, and the
  // caller can tell beforehand with state.hasCollectable, so asking for one is misuse.
  if (!state.hasCollectable) {
    throw new Error("Nothing to collect");
  }
  const tx = buildBaseTransaction(ccc.Transaction.default(), state);
  const done = await completeTransaction(tx, options);
  if (!done.ok) {
    return buildFailure(done);
  }
  return {
    ...done,
    // A collection takes only what is ready: it is done at the tip.
    estimatedMaturity: state.tip.timestamp,
    conversionKind: "collect-only",
    orderOccupiedCapacity: 0n,
    broadcastBefore: undefined,
  };
}

/**
 * Builds one direction's conversion: its plans, most direct first, the first fundable one
 * completed. A plan's direct part is deposits or withdrawal requests, the other empty, and
 * both steps add nothing for an empty one.
 */
async function buildConversion(
  options: ConversionTransactionOptions,
  ckbToIckb: boolean,
): Promise<ConversionTransactionResult> {
  const { state } = options;
  const lock = state.changeLock;
  // A plan is dropped only for a remainder order that is zero or unrepresentable.
  const plans = ckbToIckb
    ? ckbToIckbConversionPlans(options)
    : ickbToCkbConversionPlans(options);
  if (plans.length === 0) {
    return {
      ok: false,
      reason: "amount-too-small",
      minimum: minimumOrderAmount(ckbToIckb, state),
    };
  }
  const done = await completeFirstFundable(
    plans,
    (candidate) => {
      let partial = buildBaseTransaction(ccc.Transaction.default(), state, {
        deposits: candidate.selectedDeposits,
        lock,
      });
      // A receipt for no deposits is refused on chain, so the deposit step needs one.
      if (candidate.depositCount > 0) {
        partial = deposit(partial, candidate.depositCount, state.depositCapacity, lock);
      }
      return mint(partial, lock, candidate.order.estimate.info, candidate.order.amounts);
    },
    async (partial) => completeTransaction(partial, options),
  );
  if (!done.ok) {
    return buildFailure(done);
  }
  const { candidate: plan, tx, plannedFee } = done;
  return {
    ok: true,
    tx,
    plannedFee,
    estimatedMaturity: plan.estimatedMaturity,
    conversionKind:
      plan.depositCount > 0 || plan.selectedDeposits.length > 0
        ? "direct-plus-order"
        : "order",
    orderOccupiedCapacity: orderOccupiedCapacity(tx),
    broadcastBefore: broadcastDeadline(
      plan.selectedDeposits.map(({ claimEpoch }) => claimEpoch),
      state.lockUp,
    ),
  };
}

/**
 * The capacity the transaction's order and master outputs occupy. A conversion creates no
 * order output but the one it mints: collected orders are inputs, never rebuilt.
 */
function orderOccupiedCapacity(tx: ccc.Transaction): bigint {
  let occupied = 0n;
  for (const cell of tx.outputCells) {
    const { lock, type } = cell.cellOutput;
    if (lock.eq(ORDER) || type?.eq(ORDER) === true) {
      occupied += ccc.fixedPointFrom(cell.occupiedSize);
    }
  }
  return occupied;
}

/**
 * Adds the state's collect steps to a partial transaction: the withdrawal requests when
 * given, then the collectable orders, the receipts, and the ready withdrawals.
 *
 * @remarks
 * The result is still partial. Callers should use `completeTransaction` (complete.ts)
 * before signing and sending. The withdrawals move their deposit headers to the front of
 * `headerDeps`, so the given transaction must not reference a header by position.
 */
export function buildBaseTransaction(
  txLike: ccc.TransactionLike,
  steps: CollectSteps,
  withdrawalRequest?: { deposits: DepositCell[]; lock: ccc.Script },
): ccc.Transaction {
  // Each step returns the transaction unchanged when it has nothing to add.
  let tx = ccc.Transaction.from(txLike);
  if (withdrawalRequest !== undefined) {
    tx = requestWithdrawal(tx, withdrawalRequest.deposits, withdrawalRequest.lock);
  }
  tx = melt(tx, steps.availableOrders);
  tx = completeDeposit(tx, steps.receipts);
  return withdraw(tx, steps.readyWithdrawals);
}

/**
 * The build's value for a failed completion: a shortfall is the caller's to show. The DAO
 * output limit throws instead: a walk's last plans have at most four outputs, so ending on it
 * is a defect.
 */
function buildFailure(
  failure: CompletionFailure,
): Exclude<CompletionFailure, { reason: "dao-output-limit" }> {
  if (failure.reason === "dao-output-limit") {
    throw new Error("The last plan exceeds the DAO output limit");
  }
  return failure;
}
