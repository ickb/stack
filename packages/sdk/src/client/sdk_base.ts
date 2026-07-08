import { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "@ickb/core";
import { assertDaoOutputLimit } from "@ickb/dao";
import type { Info, OrderGroup } from "@ickb/order";
import type { ValueComponents } from "@ickb/utils";
import { isChangeCellCapacityError } from "../conversion/sdk_conversion_common.ts";
import { assertReadyWithdrawalDeposits } from "../withdrawal/withdrawal_selection.ts";
import { sdkManagers } from "./sdk_state_store.ts";
import type {
  BuildBaseTransactionOptions,
  CompleteIckbTransactionOptions,
} from "./sdk_types.ts";

/**
 * Base SDK transaction helpers shared by conversion and L1 APIs.
 *
 * @public
 */
export class IckbSdkBase {
  /**
   * Completes iCKB/xUDT inputs and transaction fees for a partial transaction.
   *
   * @remarks
   * This does not sign or send the transaction. It retries fee completion once
   * when CCC needs to place fee change into an existing iCKB-owned output.
   */
  public async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    const { ickbUdt } = sdkManagers(this);
    const tx = await ickbUdt.completeBy(txLike, options.signer);
    try {
      await tx.completeFeeBy(options.signer, options.feeRate);
    } catch (error) {
      if (!isChangeCellCapacityError(error)) {
        throw error;
      }

      const retryTx = await ickbUdt.completeBy(txLike, options.signer);
      const feeChangeOutputIndex = await this.findFeeChangeOutputIndex(
        retryTx,
        options.signer,
      );
      if (feeChangeOutputIndex === undefined) {
        throw error;
      }
      await retryTx.completeFeeChangeToOutput(
        options.signer,
        feeChangeOutputIndex,
        options.feeRate,
      );
      await assertDaoOutputLimit(retryTx, options.client);
      return retryTx;
    }
    await assertDaoOutputLimit(tx, options.client);
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
    const { order } = sdkManagers(this);
    const lock =
      "codeHash" in user ? user : (await user.getRecommendedAddressObj()).script;
    return order.mint(txLike, lock, info, amounts);
  }

  /**
   * Adds order group inputs for collection or fulfilled-order cleanup.
   */
  public collect(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: { isFulfilledOnly?: boolean },
  ): ccc.Transaction {
    return sdkManagers(this).order.melt(txLike, groups, options);
  }

  /**
   * Adds common collect steps to a partial conversion transaction.
   *
   * @remarks
   * The result is still partial. Callers should use `completeTransaction` before
   * signing and sending.
   */
  public async buildBaseTransaction(
    txLike: ccc.TransactionLike,
    client: ccc.Client,
    options: BuildBaseTransactionOptions = {},
  ): Promise<ccc.Transaction> {
    const { ownedOwner, ickbLogic } = sdkManagers(this);
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
      tx = await ownedOwner.requestWithdrawal(
        tx,
        withdrawalRequest.deposits,
        withdrawalRequest.lock,
        client,
        requiredLiveDeposits.length > 0 ? { requiredLiveDeposits } : undefined,
      );
    }
    if (orders.length > 0) {
      tx = this.collect(tx, orders);
    }
    if (receipts.length > 0) {
      tx = ickbLogic.completeDeposit(tx, receipts);
    }
    if (readyWithdrawals.length > 0) {
      tx = await ownedOwner.withdraw(tx, readyWithdrawals, client);
    }
    return tx;
  }

  /**
   * Throws when the chain tip changed since the sampled state was built.
   */
  public async assertCurrentTip(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
  ): Promise<void> {
    const currentTip = await client.getTipHeader();
    if (currentTip.number !== tip.number || currentTip.hash !== tip.hash) {
      throw new Error(
        `L1 state scan crossed chain tip; sampled block ${String(tip.number)} ${tip.hash}; current block ${String(currentTip.number)} ${currentTip.hash}; retry with a fresh state`,
      );
    }
  }

  private async findFeeChangeOutputIndex(
    tx: ccc.Transaction,
    signer: ccc.Signer,
  ): Promise<number | undefined> {
    const { ickbLogic, ownedOwner, order } = sdkManagers(this);
    const { script: userLock } = await signer.getRecommendedAddressObj();
    let masterIndex: number | undefined;
    let ownerIndex: number | undefined;
    for (const [index, output] of Array.from(tx.outputs.entries()).toReversed()) {
      if (!output.lock.eq(userLock)) {
        continue;
      }
      if (output.type?.eq(ickbLogic.script) === true) {
        return index;
      }
      if (masterIndex === undefined && output.type?.eq(order.script) === true) {
        masterIndex = index;
      }
      if (ownerIndex === undefined && output.type?.eq(ownedOwner.script) === true) {
        ownerIndex = index;
      }
    }
    return masterIndex ?? ownerIndex;
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
