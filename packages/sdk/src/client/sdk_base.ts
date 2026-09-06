import { ccc } from "@ckb-ccc/core";
import type {
  IckbDepositCell,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
} from "../core/index.ts";
import { assertDaoOutputLimit } from "../dao/index.ts";
import type { Info, OrderGroup, OrderManager } from "../order/index.ts";
import {
  defaultCellPageSize,
  defaultScanBudget,
  findSignerCellsPagedNoCache,
  isPlainCapacityCell,
  PagedScanBudgetError,
  PagedScanCursorError,
  type PagedScanBudget,
  type ValueComponents,
} from "../utils/index.ts";
import { assertReadyWithdrawalDeposits } from "../withdrawal/withdrawal_selection.ts";
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
  protected readonly bots: ccc.Script[];

  constructor({ ickbUdt, ownedOwner, ickbLogic, order, bots }: SdkManagers) {
    this.ickbUdt = ickbUdt;
    this.ownedOwner = ownedOwner;
    this.ickbLogic = ickbLogic;
    this.order = order;
    this.bots = bots;
  }

  /**
   * Completes iCKB/xUDT inputs and transaction fees for a partial transaction.
   *
   * @remarks This does not sign or send the transaction. Candidate inputs come
   * from bounded committed scans and ordinary change is always a plain cell.
   * Existing outputs are never reinterpreted or resized as fee change.
   * Callers must resolve or independently exclude inputs from pending attempts
   * before rebuilding; completion deliberately does not chain pending outputs.
   */
  public async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    // The xUDT and fee scans page over every signer lock on one shared budget.
    const budget = defaultScanBudget({ pageSize: defaultCellPageSize });
    try {
      const tx = await this.ickbUdt.completeBy(
        ccc.Transaction.from(txLike).clone(),
        options.signer,
        { budget },
      );
      await this.completeFeeFromCommittedCells(tx, options, budget);
      assertDaoOutputLimit(tx, this.ickbLogic.daoManager.script);
      return tx;
    } catch (error) {
      if (
        error instanceof PagedScanBudgetError ||
        error instanceof PagedScanCursorError
      ) {
        throw new IckbError(
          "Transaction completion did not finish its committed-cell scan",
          { code: "account_scan_limit", cause: error },
        );
      }
      throw error;
    }
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
  public collect(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: { isFulfilledOnly?: boolean },
  ): ccc.Transaction {
    return this.order.melt(txLike, groups, options);
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
      const requiredLiveDeposits = withdrawalRequest.requiredLiveDeposits ?? [];
      assertReadyWithdrawalDeposits(withdrawalRequest.deposits);
      assertRequiredLiveWithdrawalDeposits(
        withdrawalRequest.deposits,
        requiredLiveDeposits,
      );
      tx = this.ownedOwner.requestWithdrawal(
        tx,
        withdrawalRequest.deposits,
        withdrawalRequest.lock,
        requiredLiveDeposits.length > 0 ? { requiredLiveDeposits } : undefined,
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

  private async completeFeeFromCommittedCells(
    tx: ccc.Transaction,
    options: CompleteIckbTransactionOptions,
    budget: PagedScanBudget,
  ): Promise<void> {
    const candidates = findSignerCellsPagedNoCache(
      options.signer,
      { scriptLenRange: [0, 1], outputDataLenRange: [0, 1] },
      { pageSize: defaultCellPageSize, budget },
    );
    const selected = new Set(
      tx.inputs.map(({ previousOutput }) => previousOutput.toHex()),
    );
    for (;;) {
      try {
        await tx.completeFeeBy(options.signer, options.feeRate, undefined, {
          shouldAddInputs: false,
        });
        return;
      } catch (error) {
        if (!(error instanceof ccc.ErrorTransactionInsufficientCapacity)) {
          throw error;
        }
        await this.addCommittedCapacity(tx, candidates, selected, error);
      }
    }
  }

  private async addCommittedCapacity(
    tx: ccc.Transaction,
    candidates: AsyncGenerator<ccc.Cell, void>,
    selected: Set<string>,
    shortfall: ccc.ErrorTransactionInsufficientCapacity,
  ): Promise<void> {
    let addedCapacity = 0n;
    while (addedCapacity < shortfall.amount) {
      const next = await candidates.next();
      if (next.done === true) {
        throw new IckbError(shortfall.message, {
          code: "insufficient_capacity",
          cause: shortfall,
        });
      }
      const cell = next.value;
      const outPoint = cell.outPoint.toHex();
      if (selected.has(outPoint) || !isPlainCapacityCell(cell)) {
        continue;
      }
      selected.add(outPoint);
      tx.addInput(cell);
      addedCapacity += cell.cellOutput.capacity;
    }
  }
}

function assertRequiredLiveWithdrawalDeposits(
  requestedDeposits: readonly IckbDepositCell[],
  requiredLiveDeposits: readonly IckbDepositCell[],
): void {
  const spent = new Set(
    requestedDeposits.map((deposit) => deposit.cell.outPoint.toHex()),
  );
  const seen = new Set<string>();
  for (const deposit of requiredLiveDeposits) {
    const outPoint = deposit.cell.outPoint.toHex();
    if (seen.has(outPoint)) {
      throw new Error(`Withdrawal live deposit anchor ${outPoint} is duplicated`);
    }
    if (spent.has(outPoint)) {
      throw new Error(`Withdrawal live deposit anchor ${outPoint} is also being spent`);
    }
    seen.add(outPoint);
  }
}
