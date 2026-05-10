import { ccc } from "@ckb-ccc/ccc";
import {
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import { type OrderGroup } from "@ickb/order";
import { collect, selectBoundedUdtSubset, sum } from "@ickb/utils";
import { IckbSdk, type SystemState } from "@ickb/sdk";
import {
  errorMessageOf,
  hasTransactionActivity,
  txInfoPadding,
  type TxInfo,
  type WalletConfig,
} from "./utils.ts";

const MAX_DIRECT_DEPOSITS = 60;
const MAX_WITHDRAWAL_REQUESTS = 30;

export interface TransactionContext {
  system: SystemState;
  receipts: ReceiptCell[];
  readyWithdrawals: WithdrawalGroup[];
  availableOrders: OrderGroup[];
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  estimatedMaturity: bigint;
}

export async function buildTransactionPreview(
  context: TransactionContext,
  isCkb2Udt: boolean,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  try {
    if (amount < 0n) {
      return txInfoWithError("Amount must be positive", context.estimatedMaturity);
    }

    if (isCkb2Udt && amount > context.ckbAvailable) {
      return txInfoWithError("Not enough CKB", context.estimatedMaturity);
    }

    if (!isCkb2Udt && amount > context.ickbAvailable) {
      return txInfoWithError("Not enough iCKB", context.estimatedMaturity);
    }

    const baseTx = await buildBaseTransaction(context, walletConfig);

    if (amount === 0n) {
      if (!hasTransactionActivity(baseTx)) {
        return txInfoWithError("Nothing to do for now", context.estimatedMaturity);
      }

      return await finalizeTransaction(
        baseTx,
        context.estimatedMaturity,
        context.system.feeRate,
        walletConfig,
      );
    }

    return await (isCkb2Udt
      ? buildCkbToIckbPreview(baseTx, context, amount, walletConfig)
      : buildIckbToCkbPreview(baseTx, context, amount, walletConfig));
  } catch (error) {
    return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
  }
}

async function buildBaseTransaction(
  context: TransactionContext,
  walletConfig: WalletConfig,
  withdrawalRequestDeposits: IckbDepositCell[] = [],
): Promise<ccc.Transaction> {
  return walletConfig.sdk.buildBaseTransaction(
    ccc.Transaction.default(),
    walletConfig.cccClient,
    {
      withdrawalRequest:
        withdrawalRequestDeposits.length === 0
          ? undefined
          : {
              deposits: withdrawalRequestDeposits,
              lock: walletConfig.primaryLock,
            },
      orders: context.availableOrders,
      receipts: context.receipts,
      readyWithdrawals: context.readyWithdrawals,
    },
  );
}

async function buildCkbToIckbPreview(
  baseTx: ccc.Transaction,
  context: TransactionContext,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  const depositCapacity = convert(false, ICKB_DEPOSIT_CAP, context.system.exchangeRatio);
  const depositQuotient = depositCapacity === 0n ? 0n : amount / depositCapacity;
  const maxDeposits =
    depositQuotient > BigInt(MAX_DIRECT_DEPOSITS)
      ? MAX_DIRECT_DEPOSITS
      : Number(depositQuotient);

  return findBestAttempt(maxDeposits, async (depositCount) => {
    try {
      let tx = baseTx.clone();
      let estimatedMaturity = context.estimatedMaturity;

      if (depositCount > 0) {
        tx = await walletConfig.managers.logic.deposit(
          tx,
          depositCount,
          depositCapacity,
          walletConfig.primaryLock,
          walletConfig.cccClient,
        );
      }

      const remainder = amount - depositCapacity * BigInt(depositCount);
      if (remainder > 0n) {
        const amounts = { ckbValue: remainder, udtValue: 0n };
        const estimate = IckbSdk.estimate(true, amounts, context.system);
        if (estimate.maturity === undefined) {
          return txInfoWithError(
            "Amount too small to exceed the minimum match and fee threshold",
            estimatedMaturity,
          );
        }

        estimatedMaturity = maxMaturity(estimatedMaturity, estimate.maturity);
        tx = await walletConfig.sdk.request(
          tx,
          walletConfig.primaryLock,
          estimate.info,
          amounts,
        );
      }

      return await finalizeTransaction(
        tx,
        estimatedMaturity,
        context.system.feeRate,
        walletConfig,
      );
    } catch (error) {
      return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
    }
  });
}

async function buildIckbToCkbPreview(
  baseTx: ccc.Transaction,
  context: TransactionContext,
  amount: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  const deposits = await collect(
    walletConfig.managers.logic.findDeposits(walletConfig.cccClient, {
      onChain: true,
      tip: context.system.tip,
    }),
  );

  const candidates = deposits
    .filter((deposit) => deposit.isReady)
    .sort((left, right) => compareBigInt(
      left.maturity.toUnix(context.system.tip),
      right.maturity.toUnix(context.system.tip),
    ));

  return findBestAttempt(
    Math.min(candidates.length, MAX_WITHDRAWAL_REQUESTS),
    async (withdrawalCount) => {
      try {
        let tx = baseTx.clone();
        let estimatedMaturity = context.estimatedMaturity;
        let remainder = amount;

        if (withdrawalCount > 0) {
          const selectedDeposits = selectExactCountReadyDepositsUnderAmount(
            candidates,
            withdrawalCount,
            remainder,
          );
          if (selectedDeposits.length !== withdrawalCount) {
            return txInfoWithError(
              "Not enough ready deposits to convert now",
              estimatedMaturity,
            );
          }

          tx = await buildBaseTransaction(context, walletConfig, selectedDeposits);

          remainder -= sum(0n, ...selectedDeposits.map((deposit) => deposit.udtValue));
          for (const deposit of selectedDeposits) {
            estimatedMaturity = maxMaturity(
              estimatedMaturity,
              deposit.maturity.toUnix(context.system.tip),
            );
          }
        }

        if (remainder > 0n) {
          const amounts = { ckbValue: 0n, udtValue: remainder };
          const estimate = IckbSdk.estimate(false, amounts, context.system);
          if (estimate.maturity === undefined) {
            return txInfoWithError(
              "Amount too small to exceed the minimum match and fee threshold",
              estimatedMaturity,
            );
          }

          estimatedMaturity = maxMaturity(estimatedMaturity, estimate.maturity);
          tx = await walletConfig.sdk.request(
            tx,
            walletConfig.primaryLock,
            estimate.info,
            amounts,
          );
        }

        return await finalizeTransaction(
          tx,
          estimatedMaturity,
          context.system.feeRate,
          walletConfig,
        );
      } catch (error) {
        return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
      }
    },
  );
}

async function finalizeTransaction(
  tx: ccc.Transaction,
  estimatedMaturity: bigint,
  feeRate: ccc.Num,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  tx = await walletConfig.sdk.completeTransaction(tx, {
    signer: walletConfig.signer,
    client: walletConfig.cccClient,
    feeRate,
  });

  return Object.freeze({
    tx,
    error: "",
    fee: await tx.getFee(walletConfig.cccClient),
    estimatedMaturity,
  });
}

async function findBestAttempt(
  maxQuantity: number,
  build: (quantity: number) => Promise<TxInfo>,
): Promise<TxInfo> {
  let lastError: TxInfo | undefined;
  for (let quantity = maxQuantity; quantity >= 0; quantity -= 1) {
    const attempt = await build(quantity);
    if (attempt.error === "") {
      return attempt;
    }

    lastError = attempt;
  }

  return lastError ?? txInfoWithError("Nothing to do for now", 0n);
}

export function selectExactCountReadyDepositsUnderAmount(
  deposits: IckbDepositCell[],
  wanted: number,
  amount: bigint,
): IckbDepositCell[] {
  return selectBoundedUdtSubset(deposits, amount, {
    candidateLimit: MAX_WITHDRAWAL_REQUESTS,
    minCount: wanted,
    maxCount: wanted,
  });
}

function txInfoWithError(error: string, estimatedMaturity: bigint): TxInfo {
  return Object.freeze({
    ...txInfoPadding,
    error,
    estimatedMaturity,
  });
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function maxMaturity(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
