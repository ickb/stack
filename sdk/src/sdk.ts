import { ccc } from "@ckb-ccc/core";
import { getConfig, type SupportedChain } from "./constants.ts";
import { minimumOrderAmount } from "./conversion/estimate.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "./conversion/plans.ts";
import type {
  AccountState,
  ConversionTransactionContext,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  SdkManagers,
  SystemState,
} from "./conversion/types.ts";
import {
  assertDaoOutputLimit,
  assertFresh,
  broadcastDeadline,
  DaoHeaderIndexError,
  DaoOutputLimitError,
  type LockUpPolicy,
  pushHeaderDep,
  tipMaxAgeMs,
} from "./dao.ts";
import type { IckbDepositCell, LogicManager, ReceiptCell } from "./logic.ts";
import type { OrderGroup } from "./order/cells.ts";
import type { OrderManager } from "./order/order.ts";
import { Ratio } from "./order/ratio.ts";
import type { OwnedOwnerManager } from "./owned_owner.ts";
import {
  ckbFromUdt,
  ICKB_DEPOSIT_CAP,
  ickbExchangeRatio,
  type IckbUdt,
  type ProtocolCell,
} from "./udt.ts";
import { signerAccountLocks } from "./utils/signer.ts";
import { compareBigInt, findCells, isPlainCapacityCell, unique } from "./utils/utils.ts";
import { verifiedClient } from "./utils/verified_client.ts";

/**
 * Options for completing a partial iCKB transaction before signing and sending.
 */
export interface CompleteIckbTransactionOptions {
  /** Signer that prepares the transaction; its recommended lock owns the change by default. */
  signer: ccc.Signer;

  /** Lock that owns the change, iCKB and plain, when not the signer's recommended lock. */
  lock?: ccc.Script;

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
 * 180 ms of local completion). A miner paying the bot adds about forty cellbase cells per
 * turn, which this outpaces; a larger backlog takes several transactions.
 */
export const SWEEP_INPUT_LIMIT = 1000;

/** The options with the lock resolved to the signer's recommended one when absent. */
type ResolvedConversionOptions = ConversionTransactionOptions & { lock: ccc.Script };

/** What every own transaction collects along: the context's collectable positions. */
type CollectSteps = Pick<
  ConversionTransactionContext,
  "availableOrders" | "receipts" | "readyWithdrawals"
>;

/**
 * The whole SDK, which the Node actors drive by relative import; the package barrel
 * exposes the two conversion-workflow methods, and its assignment checks they agree.
 */
export class IckbSdk {
  private readonly ickbUdt: IckbUdt;
  private readonly ownedOwner: OwnedOwnerManager;
  private readonly ickbLogic: LogicManager;
  private readonly order: OrderManager;

  constructor({ ickbUdt, ownedOwner, ickbLogic, order }: SdkManagers) {
    this.ickbUdt = ickbUdt;
    this.ownedOwner = ownedOwner;
    this.ickbLogic = ickbLogic;
    this.order = order;
  }

  /** Creates the SDK for one chain's deployment. */
  public static fromChain(chain: SupportedChain): IckbSdk {
    return new IckbSdk(getConfig(chain));
  }

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
      this.ickbLogic.findDeposits(client, tip),
      this.order.findOrders(client),
      // CCC clamps the sampled median at the cap, the connector's chosen rate too. A given cap
      // replaces CCC's default ceiling, on purpose: the caller's cap is the ceiling.
      client.getFeeRate(undefined, maxFeeRate === undefined ? undefined : { maxFeeRate }),
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
        orderPool: orders.filter((group) => isPastPar(group, exchangeRatio)),
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
      this.ickbLogic.receiptsFrom(client, scanned),
      this.ownedOwner.withdrawalGroupsFrom(client, scanned, tip),
    ]);
    return {
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCells: cells.filter((cell) => this.ickbUdt.isUdt(cell)),
      receipts,
      withdrawalGroups,
    };
  }

  // ---- Conversion planning -----------------------------------------------------------

  /**
   * Builds and completes one conversion transaction from a conversion context.
   *
   * @remarks
   * Every branch returns a transaction funded from the signer's committed cells: the
   * candidate plans (deposit counts, or prefixes of the greedy withdrawal selection with
   * their rebuilt remainder order) are completed most direct first and the first fundable one
   * wins, so a wallet short of CKB degrades to fewer direct actions plus a larger standing
   * order rather than failing. Failure results are
   * expected planning outcomes; when no plan can be funded the last completion error throws.
   */
  public async buildConversionTransaction(
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, context, direction } = options;
    if (amount < 0n) {
      return conversionFailure("amount-negative");
    }
    if (direction === "ckb-to-ickb" && amount > context.ckbAvailable) {
      return conversionFailure("insufficient-ckb");
    }
    if (direction === "ickb-to-ckb" && amount > context.ickbAvailable) {
      return conversionFailure("insufficient-ickb");
    }

    const resolved = {
      ...options,
      lock: options.lock ?? (await options.signer.getRecommendedAddressObj()).script,
    };
    if (amount === 0n) {
      return this.buildCollectOnlyConversion(resolved);
    }
    return direction === "ckb-to-ickb"
      ? this.buildCkbToIckbConversion(resolved)
      : this.buildIckbToCkbConversion(resolved);
  }

  private async buildCollectOnlyConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock, signer } = options;
    // An empty collection to a lock of the signer's own would only compact the account;
    // to another lock it moves the liquid cells, which completion builds from the sweep.
    if (
      !hasCollectable(context) &&
      (context.cells.length === 0 || (await isOwnLock(signer, lock)))
    ) {
      return conversionFailure("nothing-to-do");
    }
    const tx = this.buildBaseTransaction(ccc.Transaction.default(), context);
    const completed = await this.completeConversion(tx, options);
    return {
      ok: true,
      ...completed,
      estimatedMaturity: context.estimatedMaturity,
      conversionKind: "collect-only",
      isSweepComplete: sweepsAll(completed.tx, context.cells),
    };
  }

  private async buildCkbToIckbConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    // A plan is dropped only for an unrepresentable remainder order.
    const plans = ckbToIckbConversionPlans(options);
    if (plans.length === 0) {
      return {
        ok: false,
        reason: "amount-too-small",
        minimum: minimumOrderAmount(true, context.system),
      };
    }
    const {
      candidate: plan,
      tx,
      plannedFee,
    } = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(ccc.Transaction.default(), context);
        if (candidate.depositCount > 0) {
          partial = this.ickbLogic.deposit(
            partial,
            candidate.depositCount,
            candidate.depositCapacity,
            lock,
          );
        }
        if (candidate.order !== undefined) {
          partial = this.order.mint(
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
    return {
      ok: true,
      tx,
      plannedFee,
      estimatedMaturity: plan.estimatedMaturity,
      conversionKind: conversionKind(plan.depositCount > 0, plan.order !== undefined),
      isSweepComplete: sweepsAll(tx, context.cells),
    };
  }

  private async buildIckbToCkbConversion(
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    const plans = ickbToCkbConversionPlans(options, context.system.poolDeposits);
    if (plans.length === 0) {
      return {
        ok: false,
        reason: "amount-too-small",
        minimum: minimumOrderAmount(false, context.system),
      };
    }
    const {
      candidate: plan,
      tx,
      plannedFee,
    } = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(ccc.Transaction.default(), context, {
          deposits: candidate.selectedDeposits,
          lock,
        });
        if (candidate.order !== undefined) {
          partial = this.order.mint(
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
    const notice = plan.order?.estimate.notice;
    const broadcastBefore = broadcastDeadline(
      plan.selectedDeposits.map((deposit) => deposit.claimEpoch),
      context.system.lockUp,
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
      ...(notice === undefined ? {} : { conversionNotice: notice }),
      isSweepComplete: sweepsAll(tx, context.cells),
      ...(broadcastBefore === undefined ? {} : { broadcastBefore }),
    };
  }

  private async completeConversion(
    tx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<CompletedTransaction> {
    const { signer, lock, context } = options;
    const { system, receipts, cells } = context;
    return this.completeTransaction(tx, { signer, lock, system, receipts, cells });
  }

  // ---- Transaction building ----------------------------------------------------------

  /**
   * Adds the context's collect steps to a partial transaction: the withdrawal requests when
   * given, then the collectable orders, the receipts, and the ready withdrawals.
   *
   * @remarks
   * The result is still partial. Callers should use `completeTransaction` before
   * signing and sending. The withdrawals move their deposit headers to the front of
   * `headerDeps`, so the given transaction must not reference a header by position.
   */
  public buildBaseTransaction(
    txLike: ccc.TransactionLike,
    steps: CollectSteps,
    withdrawalRequest?: { deposits: IckbDepositCell[]; lock: ccc.Script },
  ): ccc.Transaction {
    let tx = ccc.Transaction.from(txLike);
    if (withdrawalRequest !== undefined && withdrawalRequest.deposits.length > 0) {
      tx = this.ownedOwner.requestWithdrawal(
        tx,
        withdrawalRequest.deposits,
        withdrawalRequest.lock,
      );
    }
    if (steps.availableOrders.length > 0) {
      tx = this.order.melt(tx, steps.availableOrders);
    }
    if (steps.receipts.length > 0) {
      tx = this.ickbLogic.completeDeposit(tx, steps.receipts);
    }
    if (steps.readyWithdrawals.length > 0) {
      tx = this.ownedOwner.withdraw(tx, steps.readyWithdrawals);
    }
    return tx;
  }

  /**
   * Completes iCKB inputs, iCKB change, plain change, and the fee from the cells it is given.
   *
   * @remarks Completion never scans. `cells` are the signer's known liquid cells, plain
   * CKB and iCKB, from the account state already read: the largest ones fund what the
   * outputs need, the rest ride along as a sweep while the transaction has fewer than
   * {@link SWEEP_INPUT_LIMIT} inputs, so every own transaction compacts the account.
   * Ordinary change is always a plain cell; existing outputs
   * are never reinterpreted or resized as fee change. This does not sign or send.
   */
  public async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<CompletedTransaction> {
    const { signer, system } = options;
    const { feeRate } = system;
    const tx = ccc.Transaction.from(txLike).clone();
    tx.addCellDeps(this.ickbUdt.cellDeps);
    const changeLock = options.lock ?? (await signer.getRecommendedAddressObj()).script;
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
      .filter((cell) => this.ickbUdt.isUdt(cell))
      .toSorted((left, right) => compareBigInt(udtBalance(right), udtBalance(left)));
    const plainCells = unspent
      .filter(isPlainCapacityCell)
      .toSorted((left, right) =>
        compareBigInt(right.cellOutput.capacity, left.cellOutput.capacity),
      );

    await this.completeIckb(
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
    assertDaoOutputLimit(tx, this.ickbLogic.dao.script);
    return { tx, plannedFee };
  }

  /** iCKB: what the outputs need first, then the sweep while the limit allows, then change. */
  private async completeIckb(
    tx: ccc.Transaction,
    client: ccc.Client,
    changeLock: ccc.Script,
    ickbCells: readonly ccc.Cell[],
    protocolCells: readonly ProtocolCell[],
  ): Promise<void> {
    const required = tx.getOutputsUdtBalance(this.ickbUdt.script);
    let balance = await this.ickbUdt.inputBalance(tx, client, protocolCells);
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
    this.ickbUdt.addChange(tx, changeLock, balance - required);
  }
}

/**
 * Whether the context holds anything the collect steps take, so that a zero-amount
 * conversion, `buildBaseTransaction` alone, has something to collect.
 */
export function hasCollectable(context: ConversionTransactionContext): boolean {
  return (
    context.availableOrders.length > 0 ||
    context.receipts.length > 0 ||
    context.readyWithdrawals.length > 0
  );
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
  reason: Exclude<ConversionTransactionFailureReason, "amount-too-small">,
): ConversionTransactionResult {
  return { ok: false, reason };
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

/** Whether every liquid cell became an input; false when the input limit cut the sweep. */
function sweepsAll(tx: ccc.Transaction, cells: readonly ccc.Cell[]): boolean {
  const spent = new Set(tx.inputs.map((input) => input.previousOutput.toHex()));
  return cells.every((cell) => spent.has(cell.outPoint.toHex()));
}

async function isOwnLock(signer: ccc.Signer, lock: ccc.Script): Promise<boolean> {
  return (await signerAccountLocks(signer)).some((own) => own.eq(lock));
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
 * Capacity, DAO output-limit and DAO header-index failures advance
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
