import { ccc } from "@ckb-ccc/core";
import {
  assertDaoOutputLimit,
  type IckbUdt,
  type LogicManager,
  type OwnedOwnerManager,
} from "../core/index.ts";
import { assertReadyWithdrawalDeposits } from "../core/withdrawal_selection.ts";
import type { OrderGroup } from "../order/cells.ts";
import type { Info } from "../order/info.ts";
import type { OrderManager } from "../order/order.ts";
import {
  compareBigInt,
  isPlainCapacityCell,
  type ValueComponents,
} from "../utils/index.ts";
import { IckbError } from "./sdk_error.ts";
import type {
  BuildBaseTransactionOptions,
  CompleteIckbTransactionOptions,
  SdkManagers,
} from "./sdk_types.ts";

/**
 * Base SDK transaction helpers shared by conversion and L1 APIs.
 *
 */
export abstract class IckbSdkBase {
  protected readonly ickbUdt: IckbUdt;
  protected readonly ownedOwner: OwnedOwnerManager;
  protected readonly ickbLogic: LogicManager;
  protected readonly order: OrderManager;

  constructor({ ickbUdt, ownedOwner, ickbLogic, order }: SdkManagers) {
    this.ickbUdt = ickbUdt;
    this.ownedOwner = ownedOwner;
    this.ickbLogic = ickbLogic;
    this.order = order;
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

  /**
   * Adds a user-owned order request to a partial transaction.
   */
  public async request(
    txLike: ccc.TransactionLike,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<ccc.Transaction> {
    const lock =
      "codeHash" in user ? user : (await user.getRecommendedAddressObj()).script;
    return this.order.mint(txLike, lock, info, amounts);
  }

  /**
   * Adds order group inputs for collection or fulfilled-order cleanup.
   */
  public collect(txLike: ccc.TransactionLike, groups: OrderGroup[]): ccc.Transaction {
    return this.order.melt(txLike, groups);
  }

  /**
   * Adds common collect steps to a partial conversion transaction.
   *
   * @remarks
   * The result is still partial. Callers should use `completeTransaction` before
   * signing and sending.
   */
  public buildBaseTransaction(
    txLike: ccc.TransactionLike,
    options: BuildBaseTransactionOptions = {},
  ): ccc.Transaction {
    let tx = ccc.Transaction.from(txLike);
    const {
      withdrawalRequest,
      orders = [],
      receipts = [],
      readyWithdrawals = [],
    } = options;
    if (withdrawalRequest !== undefined && withdrawalRequest.deposits.length > 0) {
      assertReadyWithdrawalDeposits(withdrawalRequest.deposits);
      tx = this.ownedOwner.requestWithdrawal(
        tx,
        withdrawalRequest.deposits,
        withdrawalRequest.lock,
      );
    }
    if (orders.length > 0) {
      tx = this.collect(tx, orders);
    }
    if (receipts.length > 0) {
      tx = this.ickbLogic.completeDeposit(tx, receipts);
    }
    if (readyWithdrawals.length > 0) {
      tx = this.ownedOwner.withdraw(tx, readyWithdrawals);
    }
    return tx;
  }
}

/**
 * Prepared-size budget one own transaction may grow to while sweeping liquid cells.
 *
 * @remarks Measured as CCC charges fees, `toBytes().length + 4`. About a tenth of a
 * block; it admits roughly 1,400 inputs, so it outpaces one cellbase cell per block
 * from a miner paying the bot and is never reached after the first sweep.
 */
export const TRANSACTION_SIZE_BUDGET = 64 * 1024;

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
