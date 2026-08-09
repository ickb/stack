import { ccc } from "@ckb-ccc/core";
import type {
  IckbDepositCell,
  IckbUdt,
  LogicManager,
  OwnedOwnerManager,
} from "@ickb/core";
import { assertDaoOutputLimit, DAO_OUTPUT_LIMIT, DaoOutputLimitError } from "@ickb/dao";
import type { Info, OrderGroup, OrderManager } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import { isChangeCellCapacityError } from "../conversion/sdk_conversion_common.ts";
import { assertReadyWithdrawalDeposits } from "../withdrawal/withdrawal_selection.ts";
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
   * @remarks
   * This does not sign or send the transaction. It retries fee completion once
   * when CCC needs to place fee change into an existing iCKB-owned output or
   * ordinary fee change would exceed the DAO output limit.
   */
  public async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    const pristineTx = ccc.Transaction.from(txLike).clone();
    const tx = await this.ickbUdt.completeBy(pristineTx.clone(), options.signer);
    const outputCountBeforeFee = tx.outputs.length;
    try {
      await tx.completeFeeBy(options.signer, options.feeRate);
    } catch (error) {
      if (!isChangeCellCapacityError(error)) {
        throw error;
      }

      const retryTx = await this.completeFeeChangeToOutput(pristineTx, options);
      if (retryTx === undefined) {
        throw error;
      }
      return retryTx;
    }
    try {
      assertDaoOutputLimit(tx, this.ickbLogic.daoManager.script);
    } catch (error) {
      if (
        !(error instanceof DaoOutputLimitError) ||
        outputCountBeforeFee !== DAO_OUTPUT_LIMIT ||
        tx.outputs.length !== DAO_OUTPUT_LIMIT + 1
      ) {
        throw error;
      }

      const retryTx = await this.completeFeeChangeToOutput(pristineTx, options);
      if (retryTx !== undefined) {
        return retryTx;
      }
      throw error;
    }
    return tx;
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

  private async findFeeChangeOutputIndex(
    tx: ccc.Transaction,
    signer: ccc.Signer,
  ): Promise<number | undefined> {
    const { script: userLock } = await signer.getRecommendedAddressObj();
    let masterIndex: number | undefined;
    let ownerIndex: number | undefined;
    let plainIndex: number | undefined;
    for (const [index, output] of Array.from(tx.outputs.entries()).toReversed()) {
      if (!output.lock.eq(userLock)) {
        continue;
      }
      if (output.type?.eq(this.ickbLogic.script) === true) {
        return index;
      }
      if (masterIndex === undefined && output.type?.eq(this.order.script) === true) {
        masterIndex = index;
      }
      if (ownerIndex === undefined && output.type?.eq(this.ownedOwner.script) === true) {
        ownerIndex = index;
      }
      if (plainIndex === undefined && output.type === undefined) {
        plainIndex = index;
      }
    }
    return masterIndex ?? ownerIndex ?? plainIndex;
  }

  private async completeFeeChangeToOutput(
    pristineTx: ccc.Transaction,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction | undefined> {
    const retryTx = await this.ickbUdt.completeBy(pristineTx.clone(), options.signer);
    const feeChangeOutputIndex = await this.findFeeChangeOutputIndex(
      retryTx,
      options.signer,
    );
    if (feeChangeOutputIndex === undefined) {
      return undefined;
    }
    await retryTx.completeFeeChangeToOutput(
      options.signer,
      feeChangeOutputIndex,
      options.feeRate,
    );
    assertDaoOutputLimit(retryTx, this.ickbLogic.daoManager.script);
    return retryTx;
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
