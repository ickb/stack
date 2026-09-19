import { ccc } from "@ckb-ccc/core";
import { getConfig } from "./constants.ts";
import { IckbError } from "./conversion/error.ts";
import { minimumOrderAmount } from "./conversion/estimate.ts";
import { completeFirstFundable } from "./conversion/fundable_walk.ts";
import { poolCkb } from "./conversion/maturity.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "./conversion/plans.ts";
import type {
  AccountState,
  CompleteIckbTransactionOptions,
  ConversionTransactionContext,
  ConversionTransactionFailureReason,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetL1StateOptions,
  PoolDepositRangeOptions,
  SdkManagers,
  SystemState,
} from "./conversion/types.ts";
import {
  assertDaoOutputLimit,
  ickbExchangeRatio,
  type IckbDepositCell,
  type IckbUdt,
  type LogicManager,
  type OwnedOwnerManager,
} from "./core/index.ts";
import type { OrderGroup } from "./order/cells.ts";
import type { OrderManager } from "./order/order.ts";
import { Ratio } from "./order/ratio.ts";
import {
  collect,
  compareBigInt,
  findCells,
  isPlainCapacityCell,
  unique,
  type SupportedChain,
} from "./utils/index.ts";

/**
 * The whole SDK, which the Node actors drive by relative import; the package barrel
 * exposes the two conversion-workflow methods, and its assignment checks they agree.
 */
export interface IckbSdk {
  /** Builds and completes a conversion, or returns a typed planning failure. */
  buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult>;
  /** Reads system, user-order, and account state against one sampled tip. */
  getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }>;
  /** Adds requested withdrawal, collection, receipt, and ready-withdrawal steps. */
  buildBaseTransaction(
    txLike: ccc.TransactionLike,
    steps: CollectSteps,
    withdrawalRequest?: { deposits: IckbDepositCell[]; lock: ccc.Script },
  ): ccc.Transaction;
  /** Completes iCKB inputs and fees without signing or sending the transaction. */
  completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction>;
}

/**
 * Prepared-size budget one own transaction may grow to while sweeping liquid cells.
 *
 * @remarks Measured as CCC charges fees, `toBytes().length + 4`. About a tenth of a
 * block; it admits roughly 1,400 inputs, so it outpaces one cellbase cell per block
 * from a miner paying the bot and is never reached after the first sweep.
 */
export const TRANSACTION_SIZE_BUDGET = 64 * 1024;

/** The options with the lock resolved to the signer's recommended one when absent. */
type ResolvedConversionOptions = ConversionTransactionOptions & { lock: ccc.Script };

/** What every own transaction collects along: the context's collectable positions. */
export type CollectSteps = Pick<
  ConversionTransactionContext,
  "availableOrders" | "receipts" | "readyWithdrawals"
>;

// eslint-disable-next-line @typescript-eslint/no-shadow -- Preserve the runtime constructor name.
const IckbSdkImplementation = class IckbSdk {
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
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
    } = getConfig(chain);
    return new IckbSdk({ ickbUdt, ownedOwner, ickbLogic: logic, order });
  }

  // ---- State reads -------------------------------------------------------------------

  /**
   * Reads system, user-order, and account state against one sampled tip.
   *
   * @remarks Every read is complete and uncapped: a large book or pool costs a slower
   * read, never a partial or failed one. Each account lock is enumerated by one uncached
   * unfiltered exact-lock scan and classified client-side (decisions amendment 52).
   */
  public async getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }> {
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const [poolDeposits, orders, feeRate, accounts] = await Promise.all([
      this.getPoolDeposits(client, tip, options?.poolDeposits),
      this.order.findOrders(client),
      getFeeRate(client),
      Promise.all(
        [...unique(locks)].map(async (lock) => this.readLockCells(client, lock, tip)),
      ),
    ]);
    // The CKB that can fill orders is the public pool: ready deposits now, the rest at maturity.
    const { ready, maturing } = poolCkb(poolDeposits, tip);
    return {
      system: {
        feeRate,
        tip,
        exchangeRatio,
        // One book, two filters (decisions amendment 52(ak)): the market side is every order
        // past par, the wallet's own included, since the bot fills by price, not by owner.
        orderPool: orders.filter((group) => isPastPar(group, exchangeRatio)),
        ckbAvailable: ready,
        ckbMaturing: maturing,
        poolDeposits,
      },
      user: { orders: orders.filter((group) => group.isOwner(...locks)) },
      account: {
        capacityCells: accounts.flatMap((account) => account.capacityCells),
        nativeUdtCells: accounts.flatMap((account) => account.nativeUdtCells),
        receipts: accounts.flatMap((account) => account.receipts),
        withdrawalGroups: accounts.flatMap((account) => account.withdrawalGroups),
      },
    };
  }

  private async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    range?: PoolDepositRangeOptions,
  ): Promise<IckbDepositCell[]> {
    return collect(
      this.ickbLogic.findDeposits(client, {
        tip,
        ...(range?.minLockUp === undefined ? {} : { minLockUp: range.minLockUp }),
        ...(range?.maxLockUp === undefined ? {} : { maxLockUp: range.maxLockUp }),
      }),
    );
  }

  /** Every Stack cell one lock owns, classified from a single exact-lock scan. */
  private async readLockCells(
    client: ccc.Client,
    lock: ccc.Script,
    tip: ccc.ClientBlockHeader,
  ): Promise<AccountState> {
    const cells = await findCells(client, {
      script: lock,
      scriptType: "lock",
      scriptSearchMode: "exact",
      withData: true,
    });
    const [receipts, withdrawalGroups] = await Promise.all([
      this.ickbLogic.receiptsFrom(client, cells),
      this.ownedOwner.withdrawalGroupsFrom(client, cells, tip),
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
   * order rather than failing (decisions amendments 41, 52(ak)). Failure results are
   * expected planning outcomes; when no plan can be funded the last completion error throws.
   */
  public async buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { amount, context, direction } = options;
    if (amount < 0n) {
      return conversionFailure("amount-negative", context.estimatedMaturity);
    }
    if (direction === "ckb-to-ickb" && amount > context.ckbAvailable) {
      return conversionFailure("insufficient-ckb", context.estimatedMaturity);
    }
    if (direction === "ickb-to-ckb" && amount > context.ickbAvailable) {
      return conversionFailure("insufficient-ickb", context.estimatedMaturity);
    }

    const baseTx = ccc.Transaction.from(txLike);
    const resolved = {
      ...options,
      lock: options.lock ?? (await options.signer.getRecommendedAddressObj()).script,
    };
    if (amount === 0n) {
      return this.buildCollectOnlyConversion(baseTx, resolved);
    }
    return direction === "ckb-to-ickb"
      ? this.buildCkbToIckbConversion(baseTx, resolved)
      : this.buildIckbToCkbConversion(baseTx, resolved);
  }

  private async buildCollectOnlyConversion(
    baseTx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock, signer } = options;
    const tx = this.buildBaseTransaction(baseTx, context);
    // An empty collection to a lock of the signer's own would only compact the account;
    // to another lock it moves the liquid cells, which completion builds from the sweep.
    if (
      !hasTransactionActivity(tx) &&
      (context.cells.length === 0 || (await isOwnLock(signer, lock)))
    ) {
      return conversionFailure("nothing-to-do", context.estimatedMaturity);
    }
    return {
      ok: true,
      tx: await this.completeConversion(tx, options),
      estimatedMaturity: context.estimatedMaturity,
      conversion: { kind: "collect-only" },
    };
  }

  private async buildCkbToIckbConversion(
    baseTx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    // A plan is dropped only for an unrepresentable remainder order.
    const plans = ckbToIckbConversionPlans(options);
    if (plans.length === 0) {
      return conversionFailure(
        "amount-too-small",
        context.estimatedMaturity,
        minimumOrderAmount(true, context.system),
      );
    }
    const { candidate: plan, tx } = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(baseTx.clone(), context);
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
      estimatedMaturity: plan.estimatedMaturity,
      conversion: {
        kind: conversionKind(plan.depositCount > 0, plan.order !== undefined),
      },
    };
  }

  private async buildIckbToCkbConversion(
    baseTx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    const plans = ickbToCkbConversionPlans(options, context.system.poolDeposits);
    if (plans.length === 0) {
      return conversionFailure(
        "amount-too-small",
        context.estimatedMaturity,
        minimumOrderAmount(false, context.system),
      );
    }
    const { candidate: plan, tx } = await completeFirstFundable(
      plans,
      (candidate) => {
        let partial = this.buildBaseTransaction(baseTx.clone(), context, {
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
    return {
      ok: true,
      tx,
      estimatedMaturity: plan.estimatedMaturity,
      conversion: {
        kind: conversionKind(plan.selectedDeposits.length > 0, plan.order !== undefined),
      },
      ...(notice === undefined ? {} : { conversionNotice: notice }),
    };
  }

  private async completeConversion(
    tx: ccc.Transaction,
    options: ResolvedConversionOptions,
  ): Promise<ccc.Transaction> {
    return this.completeTransaction(tx, {
      signer: options.signer,
      lock: options.lock,
      feeRate: options.context.system.feeRate,
      cells: options.context.cells,
    });
  }

  // ---- Transaction building ----------------------------------------------------------

  /**
   * Adds the context's collect steps to a partial transaction: the withdrawal requests when
   * given, then the collectable orders, the receipts, and the ready withdrawals.
   *
   * @remarks
   * The result is still partial. Callers should use `completeTransaction` before
   * signing and sending.
   */
  public buildBaseTransaction(
    txLike: ccc.TransactionLike,
    steps: CollectSteps,
    withdrawalRequest?: { deposits: IckbDepositCell[]; lock: ccc.Script },
  ): ccc.Transaction {
    let tx = ccc.Transaction.from(txLike);
    if (withdrawalRequest !== undefined && withdrawalRequest.deposits.length > 0) {
      for (const deposit of withdrawalRequest.deposits) {
        if (!deposit.isReady) {
          throw new Error(
            `Withdrawal deposit ${deposit.cell.outPoint.toHex()} is not ready`,
          );
        }
      }
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
   * outputs need, the rest ride along as a sweep while the prepared transaction stays
   * under {@link TRANSACTION_SIZE_BUDGET}, so every own transaction compacts the account
   * (decisions amendment 52). Ordinary change is always a plain cell; existing outputs
   * are never reinterpreted or resized as fee change. This does not sign or send.
   */
  public async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    const { signer, feeRate } = options;
    const tx = this.ickbUdt.addCellDeps(ccc.Transaction.from(txLike).clone());
    const changeLock = options.lock ?? (await signer.getRecommendedAddressObj()).script;
    // Inputs come from one state read, each cell once, and each action spends its own
    // cell kind, so a repeated out point is a builder bug: this is the one place that
    // names it, the node would refuse the transaction anyway (decisions amendment 52(y)).
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

    await this.completeIckb(tx, signer.client, changeLock, ickbCells);
    // Plain CKB: the sweep first, then whatever the fee still needs beyond the budget.
    const swept = sweep(tx, plainCells);
    await completeFee(tx, signer, changeLock, feeRate, plainCells.slice(swept));
    assertDaoOutputLimit(tx, this.ickbLogic.daoManager.script);
    return tx;
  }

  /** iCKB: what the outputs need first, then the sweep while the budget allows, then change. */
  private async completeIckb(
    tx: ccc.Transaction,
    client: ccc.Client,
    changeLock: ccc.Script,
    ickbCells: readonly ccc.Cell[],
  ): Promise<void> {
    const required = this.ickbUdt.outputBalance(tx);
    let balance = await this.ickbUdt.inputBalance(tx, client);
    for (const cell of ickbCells) {
      if (balance >= required && !withinSizeBudget(tx)) {
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
};

/** Concrete iCKB SDK constructor and static estimators. */
// eslint-disable-next-line @typescript-eslint/no-redeclare -- The public type and runtime constructor intentionally share a name.
export const IckbSdk: {
  new (managers: SdkManagers): IckbSdk;
  fromChain: (chain: SupportedChain) => IckbSdk;
} = IckbSdkImplementation;

/** Whether the transaction already carries any input or output. */
export function hasTransactionActivity(tx: ccc.Transaction): boolean {
  return tx.inputs.length > 0 || tx.outputs.length > 0;
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
  reason: ConversionTransactionFailureReason,
  estimatedMaturity: bigint,
  minimum?: bigint,
): ConversionTransactionResult {
  return {
    ok: false,
    reason,
    estimatedMaturity,
    ...(minimum === undefined ? {} : { minimum }),
  };
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

async function isOwnLock(signer: ccc.Signer, lock: ccc.Script): Promise<boolean> {
  return (await signer.getAddressObjs()).some(({ script }) => script.eq(lock));
}

async function getFeeRate(client: ccc.Client): Promise<ccc.Num> {
  const feeRate = await client.getFeeRate();
  if (feeRate < 0n) {
    throw new Error("Client fee rate must be non-negative");
  }
  return feeRate;
}

function withinSizeBudget(tx: ccc.Transaction): boolean {
  return tx.toBytes().length + 4 <= TRANSACTION_SIZE_BUDGET;
}

function udtBalance(cell: ccc.Cell): ccc.Num {
  return ccc.udtBalanceFrom(cell.outputData);
}

/** Adds cells while the prepared size stays under budget; returns how many were added. */
function sweep(tx: ccc.Transaction, cells: readonly ccc.Cell[]): number {
  let added = 0;
  for (const cell of cells) {
    if (!withinSizeBudget(tx)) {
      break;
    }
    tx.addInput(cell);
    added += 1;
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
