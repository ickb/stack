import { ccc } from "@ckb-ccc/core";
import {
  baseTransactionOptions,
  conversionFailure,
  conversionKind,
  hasTransactionActivity,
  NOTHING_TO_DO_REASON,
} from "../conversion/sdk_conversion_common.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../conversion/sdk_conversion_plans.ts";
import { completeFirstFundable } from "../withdrawal/withdrawal_completion.ts";
import { IckbSdkBase } from "./sdk_base.ts";
import type {
  CkbToIckbConversionPlan,
  ConversionTransactionOptions,
  ConversionTransactionResult,
  IckbToCkbConversionPlan,
} from "./sdk_types.ts";

/**
 * SDK layer that builds conversion transactions from a sampled state context.
 *
 */
export abstract class IckbSdkConversion extends IckbSdkBase {
  /** Reads public pool deposits and evaluates readiness against the supplied sampled tip. */

  /**
   * Builds and completes one conversion transaction from a conversion context.
   *
   * @remarks
   * Every branch returns a transaction funded from the signer's committed cells: the
   * candidate plans (deposit counts, or prefixes of the greedy withdrawal selection with
   * their rebuilt remainder order) are completed in ranked order and the first fundable one
   * wins, so a wallet short of CKB degrades to fewer direct actions plus a larger standing
   * order rather than failing (decisions amendments 41, 46(b)). Failure results are
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
    if (amount === 0n) {
      return this.buildCollectOnlyConversion(baseTx, options);
    }
    return direction === "ckb-to-ickb"
      ? this.buildCkbToIckbConversion(baseTx, options)
      : this.buildIckbToCkbConversion(baseTx, options);
  }

  private async buildCollectOnlyConversion(
    baseTx: ccc.Transaction,
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context } = options;
    const tx = this.buildBaseTransaction(baseTx, baseTransactionOptions(context));
    if (!hasTransactionActivity(tx)) {
      return conversionFailure(NOTHING_TO_DO_REASON, context.estimatedMaturity);
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
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    // A plan is dropped only for an unrepresentable remainder order.
    const plans = ckbToIckbConversionPlans(options);
    if (plans.length === 0) {
      return conversionFailure("amount-too-small", context.estimatedMaturity);
    }
    const completion = await completeFirstFundable(
      plans,
      (plan: CkbToIckbConversionPlan): ccc.Transaction => {
        let tx = this.buildBaseTransaction(
          baseTx.clone(),
          baseTransactionOptions(context),
        );
        if (plan.depositCount > 0) {
          tx = this.ickbLogic.deposit(tx, plan.depositCount, plan.depositCapacity, lock);
        }
        if (plan.order !== undefined) {
          tx = this.order.mint(tx, lock, plan.order.estimate.info, plan.order.amounts);
        }
        return tx;
      },
      async (tx) => this.completeConversion(tx, options),
    );
    const { candidate: plan, tx } = completion;
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
    options: ConversionTransactionOptions,
  ): Promise<ConversionTransactionResult> {
    const { context, lock } = options;
    const plans = ickbToCkbConversionPlans(options, context.system.poolDeposits);
    if (plans.length === 0) {
      return conversionFailure("amount-too-small", context.estimatedMaturity);
    }
    const completion = await completeFirstFundable(
      plans,
      (plan: IckbToCkbConversionPlan): ccc.Transaction => {
        let tx = this.buildBaseTransaction(
          baseTx.clone(),
          baseTransactionOptions(context, { deposits: plan.selectedDeposits, lock }),
        );
        if (plan.order !== undefined) {
          tx = this.order.mint(tx, lock, plan.order.estimate.info, plan.order.amounts);
        }
        return tx;
      },
      async (tx) => this.completeConversion(tx, options),
    );
    const { candidate: plan, tx } = completion;
    return {
      ok: true,
      tx,
      estimatedMaturity: plan.estimatedMaturity,
      conversion: {
        kind: conversionKind(plan.selectedDeposits.length > 0, plan.order !== undefined),
      },
      ...(plan.order?.conversionNotice === undefined
        ? {}
        : { conversionNotice: plan.order.conversionNotice }),
    };
  }

  private async completeConversion(
    tx: ccc.Transaction,
    options: ConversionTransactionOptions,
  ): Promise<ccc.Transaction> {
    return this.completeTransaction(tx, {
      signer: options.signer,
      feeRate: options.context.system.feeRate,
      cells: options.context.cells,
    });
  }
}
