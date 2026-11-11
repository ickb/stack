import { ccc } from "@ckb-ccc/core";
import {
  completeFirstFundable,
  completeTransaction,
  type CompleteTransactionResult,
  type CompletionFailure,
} from "./complete.ts";
import { ORDER } from "./constants.ts";
import { minimumOrderAmount } from "./conversion/estimate.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "./conversion/plans.ts";
import type {
  AccountState,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  State,
  SystemState,
} from "./conversion/types.ts";
import { assertFresh, broadcastDeadline, tipMaxAgeMs, type LockUpPolicy } from "./dao.ts";
import {
  completeDeposit,
  deposit,
  findDeposits,
  receiptsFrom,
  type IckbDepositCell,
} from "./logic.ts";
import type { OrderGroup } from "./order/cells.ts";
import { isCkbToIckb } from "./order/conversion.ts";
import { findOrders, melt, mint } from "./order/order.ts";
import { Ratio } from "./order/ratio.ts";
import { requestWithdrawal, withdraw, withdrawalGroupsFrom } from "./owned_owner.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP, ickbExchangeRatio, isUdt } from "./udt.ts";
import { findCells, isPlainCapacityCell, unique } from "./utils/utils.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/** The options with the signer's recommended lock, which owns every output for the user. */
type ResolvedConversionOptions = ConversionTransactionOptions & { lock: ccc.Script };

/** What every own transaction collects along: the state's collectable positions. */
type CollectSteps = Pick<State, "availableOrders" | "receipts" | "readyWithdrawals">;

/**
 * The whole SDK, which the Node actors drive by relative import; the package barrel
 * exposes the two conversion-workflow methods, and its assignment checks they agree.
 */
export class IckbSdk {
  // ---- State reads -------------------------------------------------------------------

  /**
   * Reads system, user-order, and account state at the sampled tip's parent, under the
   * caller's withdrawal timing rules (`BOT_LOCK_UP` or `WALLET_LOCK_UP`) and, when given, a
   * positive fee rate cap that replaces CCC's ceiling; a cap of zero or less throws.
   *
   * @remarks Every read goes through `verifiedClient` and the tip's parent is bounded by the
   * policy's slack, so a caller passes a plain client. Every read is complete and uncapped: a large
   * book or pool costs a slower read, never a partial or failed one. Each account lock is
   * enumerated by one uncached unfiltered exact-lock scan and classified client-side.
   */
  public async getL1AccountState(
    plainClient: ccc.Client,
    locks: ccc.Script[],
    lockUp: LockUpPolicy,
    maxFeeRate?: ccc.NumLike,
  ): Promise<{
    system: SystemState;
    userOrders: OrderGroup[];
    account: AccountState;
  }> {
    // CCC reads a zero cap as no cap at all and would plan at a negative one.
    if (maxFeeRate !== undefined && ccc.numFrom(maxFeeRate) <= ccc.Zero) {
      throw new RangeError("maxFeeRate must be positive");
    }
    // A reserve of zero would send up to the claim itself, a reserve at or past the margin
    // leaves no fresh tip, a maximum at or below the margin selects nothing, and so does a
    // margin of a cycle, since every claim lies within one.
    const { minLockUp, maxLockUp, broadcastReserve } = lockUp;
    if (
      broadcastReserve.compare(ccc.Epoch.Genesis) <= 0 ||
      minLockUp.compare(broadcastReserve) <= 0 ||
      maxLockUp.compare(minLockUp) <= 0 ||
      minLockUp.compare(ccc.Epoch.OneNervosDaoCycle) >= 0
    ) {
      throw new RangeError(
        "lockUp must satisfy 0 < broadcastReserve < minLockUp < maxLockUp, with minLockUp under one DAO cycle",
      );
    }
    const client = verifiedClient(plainClient);
    const live = await client.getTipHeader();
    // The live tip can still lose a one-block race, and a transaction naming it as a header
    // dep is then refused after signing; every recorded fork was one block deep.
    const tip = await client.getHeaderByNumber(live.number - 1n);
    if (tip?.hash !== live.parentHash) {
      throw new Error(
        `Block ${String(live.number - 1n)} is not the parent of tip ${live.hash}`,
      );
    }
    // The age bound is on the header the read is priced at: a fresh tip a node invented can
    // name any old block as its parent.
    assertFresh(tip, tipMaxAgeMs(lockUp));
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const [poolDeposits, orders, feeRate, accounts] = await Promise.all([
      findDeposits(client, tip),
      findOrders(client),
      // CCC clamps the sampled median at the cap, the connector's chosen rate too. A given cap
      // replaces CCC's default ceiling, on purpose: the caller's cap is the ceiling; an absent
      // one leaves that default.
      client.getFeeRate(undefined, { maxFeeRate }),
      Promise.all(
        [...unique(locks)].map(async (lock) => this.readLockCells(client, lock, tip)),
      ),
    ]);
    return {
      system: {
        feeRate,
        tip,
        exchangeRatio,
        depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
        // One book, two filters: the market side is every order
        // past par, the wallet's own included, since the bot fills by price, not by owner.
        orderBook: orders.filter((group) => isPastPar(group, exchangeRatio)),
        poolDeposits,
        lockUp,
      },
      userOrders: orders.filter((group) => group.isOwner(...locks)),
      account: {
        capacityCells: accounts.flatMap((account) => account.capacityCells),
        nativeUdtCells: accounts.flatMap((account) => account.nativeUdtCells),
        receipts: accounts.flatMap((account) => account.receipts),
        withdrawalGroups: accounts.flatMap((account) => account.withdrawalGroups),
      },
    };
  }

  /** Every Stack cell one lock owns, classified from a single exact-lock scan. */
  private async readLockCells(
    client: ccc.Client,
    lock: ccc.Script,
    tip: ccc.ClientBlockHeader,
  ): Promise<AccountState> {
    const scanned = await findCells(client, {
      script: lock,
      scriptType: "lock",
      scriptSearchMode: "exact",
      withData: true,
    });
    const cells = scanned.map(({ cell }) => cell);
    const [receipts, withdrawalGroups] = await Promise.all([
      receiptsFrom(client, scanned),
      withdrawalGroupsFrom(client, scanned, tip),
    ]);
    return {
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCells: cells.filter((cell) => isUdt(cell)),
      receipts,
      withdrawalGroups,
    };
  }

  // ---- Conversion planning -----------------------------------------------------------

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
  public async buildConversionTransaction(
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, state, direction } = options;
    if (amount < 0n) {
      throw new RangeError("Conversion amount is negative");
    }
    // Checked before the collection branch too: a misspelled direction is misuse at any amount.
    const ckbToIckb = isCkbToIckb(direction);
    if (ckbToIckb && amount > state.ckbAvailable) {
      return conversionFailure("insufficient-ckb");
    }
    if (!ckbToIckb && amount > state.ickbAvailable) {
      return conversionFailure("insufficient-ickb");
    }

    const resolved = {
      ...options,
      lock: (await options.signer.getRecommendedAddressObj()).script,
    };
    if (amount === 0n) {
      return this.buildCollectOnlyConversion(resolved);
    }
    return ckbToIckb
      ? this.buildCkbToIckbConversion(resolved)
      : this.buildIckbToCkbConversion(resolved);
  }

  private async buildCollectOnlyConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { state } = options;
    // A transaction that would only compact the account is not worth its fee, and the
    // caller can tell beforehand with state.hasCollectable, so asking for one is misuse.
    if (!state.hasCollectable) {
      throw new Error("Nothing to collect");
    }
    const tx = this.buildBaseTransaction(ccc.Transaction.default(), state);
    const done = await this.completeConversion(tx, options);
    if (!done.ok) {
      return buildFailure(done);
    }
    return {
      ...done,
      // A collection takes only what is ready: it is done at the tip.
      estimatedMaturity: state.tip.timestamp,
      conversionKind: "collect-only",
    };
  }

  private async buildCkbToIckbConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { state, lock } = options;
    // A plan is dropped only for an unrepresentable remainder order.
    const plans = ckbToIckbConversionPlans(options);
    if (plans.length === 0) {
      return {
        ok: false,
        reason: "amount-too-small",
        minimum: minimumOrderAmount(true, state),
      };
    }
    const done = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(ccc.Transaction.default(), state);
        if (candidate.depositCount > 0) {
          partial = deposit(
            partial,
            candidate.depositCount,
            candidate.depositCapacity,
            lock,
          );
        }
        if (candidate.order !== undefined) {
          partial = mint(
            partial,
            lock,
            candidate.order.estimate.info,
            candidate.order.amounts,
          );
        }
        return partial;
      },
      async (partial) => this.completeConversion(partial, options),
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
      conversionKind: conversionKind(plan.depositCount > 0, plan.order !== undefined),
      ...(plan.order === undefined
        ? {}
        : { orderOccupiedCapacity: this.orderOccupiedCapacity(tx) }),
    };
  }

  private async buildIckbToCkbConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { state, lock } = options;
    const plans = ickbToCkbConversionPlans(options);
    if (plans.length === 0) {
      return {
        ok: false,
        reason: "amount-too-small",
        minimum: minimumOrderAmount(false, state),
      };
    }
    const done = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(ccc.Transaction.default(), state, {
          deposits: candidate.selectedDeposits,
          lock,
        });
        if (candidate.order !== undefined) {
          partial = mint(
            partial,
            lock,
            candidate.order.estimate.info,
            candidate.order.amounts,
          );
        }
        return partial;
      },
      async (partial) => this.completeConversion(partial, options),
    );
    if (!done.ok) {
      return buildFailure(done);
    }
    const { candidate: plan, tx, plannedFee } = done;
    const broadcastBefore = broadcastDeadline(
      plan.selectedDeposits.map(({ claimEpoch }) => claimEpoch),
      state.lockUp,
    );
    return {
      ok: true,
      tx,
      plannedFee,
      estimatedMaturity: plan.estimatedMaturity,
      conversionKind: conversionKind(
        plan.selectedDeposits.length > 0,
        plan.order !== undefined,
      ),
      ...(plan.order === undefined
        ? {}
        : { orderOccupiedCapacity: this.orderOccupiedCapacity(tx) }),
      broadcastBefore,
    };
  }

  /**
   * The capacity the transaction's order and master outputs occupy. A conversion creates no
   * order output but the one it mints: collected orders are inputs, never rebuilt.
   */
  private orderOccupiedCapacity(tx: ccc.Transaction): bigint {
    let occupied = 0n;
    for (const cell of tx.outputCells) {
      const { lock, type } = cell.cellOutput;
      if (lock.eq(ORDER) || type?.eq(ORDER) === true) {
        occupied += ccc.fixedPointFrom(cell.occupiedSize);
      }
    }
    return occupied;
  }

  private async completeConversion(
    tx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<CompleteTransactionResult> {
    const { signer, state } = options;
    return completeTransaction(tx, { signer, state });
  }

  // ---- Transaction building ----------------------------------------------------------

  /**
   * Adds the state's collect steps to a partial transaction: the withdrawal requests when
   * given, then the collectable orders, the receipts, and the ready withdrawals.
   *
   * @remarks
   * The result is still partial. Callers should use `completeTransaction` (complete.ts)
   * before signing and sending. The withdrawals move their deposit headers to the front of
   * `headerDeps`, so the given transaction must not reference a header by position.
   */
  public buildBaseTransaction(
    txLike: ccc.TransactionLike,
    steps: CollectSteps,
    withdrawalRequest?: { deposits: IckbDepositCell[]; lock: ccc.Script },
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
}

/** An order the market can fill at a gain: priced past the DAO ratio on its matchable side. */
function isPastPar(group: OrderGroup, exchangeRatio: Ratio): boolean {
  const { order } = group;
  const { info } = order.data;
  return (
    (order.isCkb2UdtMatchable() && info.ckbToUdt.compare(exchangeRatio) < 0) ||
    (order.isUdt2CkbMatchable() && exchangeRatio.compare(info.udtToCkb) < 0)
  );
}

function conversionFailure(
  reason: "insufficient-ckb" | "insufficient-ickb",
): ConversionTransactionResult {
  return { ok: false, reason };
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

/** A plan always carries a deposit or an order, else it would be a collection. */
function conversionKind(
  hasDirect: boolean,
  hasOrder: boolean,
): "direct" | "order" | "direct-plus-order" {
  if (hasDirect && hasOrder) {
    return "direct-plus-order";
  }
  return hasDirect ? "direct" : "order";
}
