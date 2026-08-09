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
import { sumUdtValue } from "../conversion/sdk_value_helpers.ts";
import { IckbSdkBase } from "./sdk_base.ts";
import { errorOf } from "./sdk_error.ts";
import {
  MAX_DIRECT_DEPOSITS,
  MAX_WITHDRAWAL_REQUESTS,
  type ConversionTransactionOptions,
  type ConversionTransactionResult,
  type GetPoolDepositsOptions,
  type PoolDepositState,
} from "./sdk_types.ts";

/**
 * SDK layer that builds conversion transactions from a sampled state context.
 *
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
  // eslint-disable-next-line @typescript-eslint/require-await -- Keep the established Promise contract while all partial manager builders are synchronous.
  public async buildConversionTransaction(
    txLike: ccc.TransactionLike,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    assertCountLimit(
      options.limits?.maxDirectDeposits ?? MAX_DIRECT_DEPOSITS,
      MAX_DIRECT_DEPOSITS,
      "maxDirectDeposits",
    );
    assertCountLimit(
      options.limits?.maxWithdrawalRequests ?? MAX_WITHDRAWAL_REQUESTS,
      MAX_WITHDRAWAL_REQUESTS,
      "maxWithdrawalRequests",
    );
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
      return this.buildCollectOnlyConversion(baseTx, options);
    }
    return direction === "ckb-to-ickb"
      ? this.buildCkbToIckbConversion(baseTx, options)
      : this.buildIckbToCkbConversion(baseTx, options);
  }

  private buildCollectOnlyConversion(
    baseTx: ccc.Transaction,
    options: ConversionTransactionOptions,
  ): ConversionTransactionResult {
    const { context } = options;
    const tx = this.buildBaseTransaction(baseTx, baseTransactionOptions(context));
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

  private buildCkbToIckbConversion(
    baseTx: ccc.Transaction,
    options: ConversionTransactionOptions,
  ): ConversionTransactionResult {
    const { context, lock } = options;
    const planResult = ckbToIckbConversionPlans(options);
    const lastFailure = planResult.lastFailure ?? NOTHING_TO_DO_REASON;
    const completionOutputReserve = this.completionOutputReserve(baseTx, context, 0n);
    let lastError: unknown;
    for (const {
      depositCapacity,
      depositCount,
      estimatedMaturity,
      order,
    } of planResult.plans) {
      const outputLimitError = plannedDaoOutputLimitError(
        baseTx,
        (depositCount > 0 ? depositCount + 1 : 0) +
          orderOutputCount(order) +
          completionOutputReserve,
        depositCount > 0 || context.readyWithdrawals.length > 0,
      );
      if (outputLimitError !== undefined) {
        lastError ??= outputLimitError;
        continue;
      }
      try {
        let tx = this.buildBaseTransaction(
          baseTx.clone(),
          baseTransactionOptions(context),
        );
        if (depositCount > 0) {
          tx = this.ickbLogic.deposit(tx, depositCount, depositCapacity, lock);
        }
        if (order !== undefined) {
          tx = this.order.mint(tx, lock, order.estimate.info, order.amounts);
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

  private buildIckbToCkbConversion(
    baseTx: ccc.Transaction,
    options: ConversionTransactionOptions,
  ): ConversionTransactionResult {
    const { context, lock } = options;
    const planResult = ickbToCkbConversionPlans(options, context.system.poolDeposits);
    const lastFailure = planResult.lastFailure ?? NOTHING_TO_DO_REASON;
    const completionOutputReserve = this.completionOutputReserve(
      baseTx,
      context,
      options.amount,
    );
    let lastError: unknown;
    for (const plan of planResult.plans) {
      const { estimatedMaturity, order, requiredLiveDeposits, selectedDeposits } = plan;
      const outputLimitError = plannedDaoOutputLimitError(
        baseTx,
        selectedDeposits.length * 2 + orderOutputCount(order) + completionOutputReserve,
        selectedDeposits.length > 0 || context.readyWithdrawals.length > 0,
      );
      if (outputLimitError !== undefined) {
        lastError ??= outputLimitError;
        continue;
      }
      try {
        let tx = this.buildBaseTransaction(
          baseTx.clone(),
          baseTransactionOptions(context, {
            deposits: selectedDeposits,
            requiredLiveDeposits,
            lock,
          }),
        );
        if (order !== undefined) {
          tx = this.order.mint(tx, lock, order.estimate.info, order.amounts);
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

  private completionOutputReserve(
    baseTx: ccc.Transaction,
    context: ConversionTransactionOptions["context"],
    plannedIckbSpend: bigint,
  ): number {
    // Caller-supplied inputs are unresolved here and may carry iCKB surplus.
    if (baseTx.inputs.length > 0) {
      return 2;
    }

    let requiredIckb = plannedIckbSpend;
    for (const output of baseTx.outputCells) {
      if (this.ickbUdt.isUdt(output)) {
        requiredIckb += ccc.udtBalanceFrom(output.outputData);
      }
    }
    const forcedIckbInputs =
      sumUdtValue(context.receipts) + sumUdtValue(context.availableOrders);
    const canNeedIckbChange =
      forcedIckbInputs > requiredIckb ||
      (forcedIckbInputs < requiredIckb && context.ickbAvailable > requiredIckb);
    return 1 + Number(canNeedIckbChange);
  }
}

function assertCountLimit(limit: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > maximum) {
    throw new RangeError(
      `${name} must be a non-negative safe integer at most ${String(maximum)}`,
    );
  }
}
