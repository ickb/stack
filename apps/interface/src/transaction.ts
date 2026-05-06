import { ccc } from "@ckb-ccc/ccc";
import {
  ICKB_DEPOSIT_CAP,
  convert,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import { type OrderGroup } from "@ickb/order";
import { collect, sum } from "@ickb/utils";
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
): Promise<ccc.Transaction> {
  let tx = ccc.Transaction.default();

  if (context.availableOrders.length > 0) {
    tx = walletConfig.sdk.collect(tx, context.availableOrders);
  }

  if (context.receipts.length > 0) {
    tx = walletConfig.managers.logic.completeDeposit(tx, context.receipts);
  }

  if (context.readyWithdrawals.length > 0) {
    tx = await walletConfig.managers.ownedOwner.withdraw(
      tx,
      context.readyWithdrawals,
      walletConfig.cccClient,
    );
  }

  return tx;
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

      return await finalizeTransaction(tx, estimatedMaturity, walletConfig);
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
        // DAO withdrawal requests must claim matching input/output indexes, so
        // build those pairs first and append the input-only base activity later.
        let tx = ccc.Transaction.default();
        let estimatedMaturity = context.estimatedMaturity;
        let remainder = amount;

        if (withdrawalCount > 0) {
          const selectedDeposits = selectReadyDeposits(
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

          tx = await walletConfig.managers.ownedOwner.requestWithdrawal(
            tx,
            selectedDeposits,
            walletConfig.primaryLock,
            walletConfig.cccClient,
          );

          remainder -= sum(0n, ...selectedDeposits.map((deposit) => deposit.udtValue));
          for (const deposit of selectedDeposits) {
            estimatedMaturity = maxMaturity(
              estimatedMaturity,
              deposit.maturity.toUnix(context.system.tip),
            );
          }
        }

        tx = appendTransaction(tx, baseTx);

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

        return await finalizeTransaction(tx, estimatedMaturity, walletConfig);
      } catch (error) {
        return txInfoWithError(errorMessageOf(error), context.estimatedMaturity);
      }
    },
  );
}

async function finalizeTransaction(
  tx: ccc.Transaction,
  estimatedMaturity: bigint,
  walletConfig: WalletConfig,
): Promise<TxInfo> {
  tx = await walletConfig.managers.ickbUdt.completeBy(tx, walletConfig.signer);
  await tx.completeFeeBy(walletConfig.signer);

  if (await ccc.isDaoOutputLimitExceeded(tx, walletConfig.cccClient)) {
    throw new Error(
      `NervosDAO transaction has ${String(tx.outputs.length)} output cells, exceeding the limit of 64`,
    );
  }

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

export function selectReadyDeposits(
  deposits: IckbDepositCell[],
  wanted: number,
  amount: bigint,
): IckbDepositCell[] {
  const boundedDeposits = deposits.slice(0, MAX_WITHDRAWAL_REQUESTS);
  if (wanted <= 0 || amount <= 0n || boundedDeposits.length < wanted) {
    return [];
  }

  interface PartialSelection {
    mask: number;
    total: bigint;
  }

  const split = Math.floor(boundedDeposits.length / 2);
  const firstHalf = boundedDeposits.slice(0, split);
  const secondHalf = boundedDeposits.slice(split);

  const compareMask = (left: number, right: number, length: number): number => {
    for (let i = 0; i < length; i += 1) {
      const leftHas = (left & (1 << i)) !== 0;
      const rightHas = (right & (1 << i)) !== 0;
      if (leftHas === rightHas) {
        continue;
      }

      return leftHas ? -1 : 1;
    }

    return 0;
  };

  const enumerate = (items: IckbDepositCell[]): PartialSelection[][] => {
    const groups = Array.from(
      { length: items.length + 1 },
      () => [] as PartialSelection[],
    );

    const search = (
      index: number,
      mask: number,
      count: number,
      total: bigint,
    ): void => {
      if (index === items.length) {
        groups[count]?.push({ mask, total });
        return;
      }

      search(index + 1, mask, count, total);

      const item = items.at(index);
      if (item === undefined) {
        return;
      }
      search(index + 1, mask | (1 << index), count + 1, total + item.udtValue);
    };

    search(0, 0, 0, 0n);
    return groups;
  };

  const compress = (items: PartialSelection[], length: number): PartialSelection[] => {
    items.sort((left, right) => {
      if (left.total < right.total) {
        return -1;
      }
      if (left.total > right.total) {
        return 1;
      }

      return compareMask(left.mask, right.mask, length);
    });

    const compressed: PartialSelection[] = [];
    for (const item of items) {
      if (compressed.at(-1)?.total !== item.total) {
        compressed.push(item);
      }
    }

    return compressed;
  };

  const firstByCount = enumerate(firstHalf);
  const secondByCount = enumerate(secondHalf).map((items) =>
    compress(items, secondHalf.length)
  );

  const findBestAtOrBelow = (
    items: PartialSelection[],
    limit: bigint,
  ): PartialSelection | undefined => {
    let low = 0;
    let high = items.length - 1;
    let bestIndex = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const item = items.at(mid);
      if (item === undefined) {
        break;
      }

      if (item.total <= limit) {
        bestIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestIndex >= 0 ? items[bestIndex] : undefined;
  };

  let best:
    | {
        firstMask: number;
        secondMask: number;
        total: bigint;
      }
    | undefined;

  for (let firstCount = 0; firstCount <= wanted; firstCount += 1) {
    const secondCount = wanted - firstCount;
    const firstSelections = firstByCount[firstCount] ?? [];
    const secondSelections = secondByCount[secondCount] ?? [];
    if (secondSelections.length === 0) {
      continue;
    }

    for (const first of firstSelections) {
      const second = findBestAtOrBelow(secondSelections, amount - first.total);
      if (!second) {
        continue;
      }

      const total = first.total + second.total;
      if (!best || total > best.total) {
        best = { firstMask: first.mask, secondMask: second.mask, total };
        continue;
      }

      if (total < best.total) {
        continue;
      }

      const firstCompare = compareMask(first.mask, best.firstMask, firstHalf.length);
      if (
        firstCompare < 0 ||
        (firstCompare === 0 &&
          compareMask(second.mask, best.secondMask, secondHalf.length) < 0)
      ) {
        best = { firstMask: first.mask, secondMask: second.mask, total };
      }
    }
  }

  if (!best) {
    return [];
  }

  const selected: IckbDepositCell[] = [];
  for (let i = 0; i < firstHalf.length; i += 1) {
    if ((best.firstMask & (1 << i)) !== 0) {
      const deposit = firstHalf.at(i);
      if (deposit !== undefined) {
        selected.push(deposit);
      }
    }
  }
  for (let i = 0; i < secondHalf.length; i += 1) {
    if ((best.secondMask & (1 << i)) !== 0) {
      const deposit = secondHalf.at(i);
      if (deposit !== undefined) {
        selected.push(deposit);
      }
    }
  }

  return selected;
}

function appendTransaction(
  target: ccc.Transaction,
  source: ccc.Transaction,
): ccc.Transaction {
  for (const cellDep of source.cellDeps) {
    target.addCellDeps(cellDep);
  }

  for (const headerDep of source.headerDeps) {
    if (!target.headerDeps.some((hash) => hash === headerDep)) {
      target.headerDeps.push(headerDep);
    }
  }

  for (const input of source.inputs) {
    target.inputs.push(input);
  }

  target.outputs.push(...source.outputs);
  target.outputsData.push(...source.outputsData);
  target.witnesses.push(...source.witnesses);

  return target;
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
