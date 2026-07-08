import { ccc } from "@ckb-ccc/core";
import {
  baseTransactionOptions,
  conversionFailure,
  conversionKind,
  hasTransactionActivity,
  isRetryableConversionBuildError,
  NOTHING_TO_DO_REASON,
  orderOutputCount,
  plannedDaoOutputLimitError,
} from "../conversion/sdk_conversion_common.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../conversion/sdk_conversion_plans.ts";
import { IckbSdkBase } from "./sdk_base.ts";
import { errorOf } from "./sdk_error.ts";
import { sdkManagers } from "./sdk_state_store.ts";
import type {
  ConversionTransactionOptions,
  ConversionTransactionResult,
  GetPoolDepositsOptions,
  PoolDepositState,
} from "./sdk_types.ts";

/**
 * SDK layer that builds conversion transactions from a sampled state context.
 *
 * @public
 */
export abstract class IckbSdkConversion extends IckbSdkBase {
  /** Reads public pool deposits and evaluates readiness against the supplied sampled tip. */
  public abstract getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: GetPoolDepositsOptions,
  ): Promise<PoolDepositState>;

  /**
   * Builds a partial conversion transaction from a conversion context.
   *
   * @remarks
   * A successful result still needs `completeTransaction`, signing, and send.
   * Failure results are expected planning outcomes; unexpected build errors throw.
   */
  public async buildConversionTransaction(
    txLike: ccc.TransactionLike,
    client: ccc.Client,
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
    if (amount === 0n) {
      return this.buildCollectOnlyConversion(baseTx, client, options);
    }
    return direction === "ckb-to-ickb"
      ? this.buildCkbToIckbConversion(baseTx, client, options)
      : this.buildIckbToCkbConversion(baseTx, client, options);
  }

  private async buildCollectOnlyConversion(
    baseTx: ccc.Transaction,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context } = options;
    const tx = await this.buildBaseTransaction(
      baseTx,
      client,
      baseTransactionOptions(context),
    );
    if (!hasTransactionActivity(tx)) {
      return conversionFailure(NOTHING_TO_DO_REASON, context.estimatedMaturity);
    }
    return {
      ok: true,
      tx,
      estimatedMaturity: context.estimatedMaturity,
      conversion: { kind: "collect-only" },
    };
  }

  private async buildCkbToIckbConversion(
    baseTx: ccc.Transaction,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    const { ickbLogic } = sdkManagers(this);
    const planResult = ckbToIckbConversionPlans(options);
    const lastFailure = planResult.lastFailure ?? NOTHING_TO_DO_REASON;
    let lastError: unknown;
    for (const {
      depositCapacity,
      depositCount,
      estimatedMaturity,
      order,
    } of planResult.plans) {
      const outputLimitError = plannedDaoOutputLimitError(
        baseTx,
        (depositCount > 0 ? depositCount + 1 : 0) + orderOutputCount(order),
        depositCount > 0 || context.readyWithdrawals.length > 0,
      );
      if (outputLimitError !== undefined) {
        lastError ??= outputLimitError;
        continue;
      }
      try {
        let tx = await this.buildBaseTransaction(
          baseTx.clone(),
          client,
          baseTransactionOptions(context),
        );
        if (depositCount > 0) {
          tx = await ickbLogic.deposit(tx, depositCount, depositCapacity, lock, client);
        }
        if (order !== undefined) {
          tx = await this.request(tx, lock, order.estimate.info, order.amounts);
        }
        return {
          ok: true,
          tx,
          estimatedMaturity,
          conversion: { kind: conversionKind(depositCount > 0, order !== undefined) },
        };
      } catch (error) {
        if (!isRetryableConversionBuildError(error)) {
          throw errorOf(error);
        }
        lastError ??= error;
      }
    }
    if (lastError !== undefined) {
      throw errorOf(lastError);
    }
    return conversionFailure(lastFailure, context.estimatedMaturity);
  }

  private async buildIckbToCkbConversion(
    baseTx: ccc.Transaction,
    client: ccc.Client,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    const poolDeposits =
      context.system.poolDeposits ??
      (await this.getPoolDeposits(client, context.system.tip));
    const planResult = ickbToCkbConversionPlans(options, poolDeposits);
    const lastFailure = planResult.lastFailure ?? NOTHING_TO_DO_REASON;
    let lastError: unknown;
    for (const plan of planResult.plans) {
      const { estimatedMaturity, order, requiredLiveDeposits, selectedDeposits } = plan;
      const outputLimitError = plannedDaoOutputLimitError(
        baseTx,
        selectedDeposits.length * 2 + orderOutputCount(order),
        selectedDeposits.length > 0 || context.readyWithdrawals.length > 0,
      );
      if (outputLimitError !== undefined) {
        lastError ??= outputLimitError;
        continue;
      }
      try {
        let tx = await this.buildBaseTransaction(
          baseTx.clone(),
          client,
          baseTransactionOptions(context, {
            deposits: selectedDeposits,
            requiredLiveDeposits,
            lock,
          }),
        );
        if (order !== undefined) {
          tx = await this.request(tx, lock, order.estimate.info, order.amounts);
        }
        return {
          ok: true,
          tx,
          estimatedMaturity,
          conversion: {
            kind: conversionKind(selectedDeposits.length > 0, order !== undefined),
          },
          ...(order?.conversionNotice === undefined
            ? {}
            : { conversionNotice: order.conversionNotice }),
        };
      } catch (error) {
        if (!isRetryableConversionBuildError(error)) {
          throw errorOf(error);
        }
        lastError ??= error;
      }
    }
    if (lastError !== undefined) {
      throw errorOf(lastError);
    }
    return conversionFailure(lastFailure, context.estimatedMaturity);
  }
}
