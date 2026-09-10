import { ccc } from "@ckb-ccc/core";
import type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionTransactionContextProjection,
  SystemState,
} from "../client/sdk_types.ts";
import type { WithdrawalGroup } from "../core/index.ts";
import type { OrderGroup } from "../order/index.ts";

/**
 * Builds the conversion planner context from account state and the caller's own orders,
 * split by what it will melt: `available` orders are collected and budgeted as account
 * value, `pending` ones stay on the book.
 *
 * @public
 */
export function projectConversionTransactionContext(
  system: SystemState,
  account: AccountState,
  orders: { available: OrderGroup[]; pending: OrderGroup[] },
): ConversionTransactionContextProjection {
  const projection = projectAccountAvailability(account, orders);
  const estimatedMaturity = [
    ...projection.pendingWithdrawals.map((group) =>
      group.owned.maturity.toUnix(system.tip),
    ),
    ...projection.pendingOrders
      .map((group) => group.order.maturity)
      .filter((maturity): maturity is bigint => maturity !== undefined),
  ].reduce(maxMaturity, system.tip.timestamp);

  return {
    projection,
    context: {
      system,
      receipts: account.receipts,
      readyWithdrawals: projection.readyWithdrawals,
      availableOrders: projection.availableOrders,
      cells: [...account.capacityCells, ...account.nativeUdtCells],
      ckbAvailable: projection.ckbAvailable,
      ickbAvailable: projection.ickbAvailable,
      estimatedMaturity,
    },
  };
}

/**
 * Splits wallet-owned CKB and iCKB into immediately available and pending value.
 *
 * @public
 */
export function projectAccountAvailability(
  account: AccountState,
  {
    available: availableOrders,
    pending: pendingOrders,
  }: { available: OrderGroup[]; pending: OrderGroup[] },
): AccountAvailabilityProjection {
  const { readyWithdrawals, pendingWithdrawals } = splitWithdrawals(
    account.withdrawalGroups,
  );
  const ckbNative = sumValues(account.capacityCells, (cell) => cell.cellOutput.capacity);
  const ickbNative = sumValues(account.nativeUdtCells, (cell) =>
    ccc.udtBalanceFrom(cell.outputData),
  );
  const ckbAvailable =
    ckbNative +
    sumCkb(account.receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  const ickbAvailable = ickbNative + sumUdt(account.receipts) + sumUdt(availableOrders);
  const ckbPending = sumCkb(pendingWithdrawals) + sumCkb(pendingOrders);
  const ickbPending = sumUdt(pendingOrders);

  return {
    ckbNative,
    ickbNative,
    ckbAvailable,
    ickbAvailable,
    ckbPending,
    ickbPending,
    ckbBalance: ckbAvailable + ckbPending,
    ickbBalance: ickbAvailable + ickbPending,
    readyWithdrawals,
    pendingWithdrawals,
    availableOrders,
    pendingOrders,
  };
}

export function maxMaturity(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function splitWithdrawals(withdrawalGroups: readonly WithdrawalGroup[]): {
  readyWithdrawals: WithdrawalGroup[];
  pendingWithdrawals: WithdrawalGroup[];
} {
  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of withdrawalGroups) {
    if (group.owned.isReady) {
      readyWithdrawals.push(group);
    } else {
      pendingWithdrawals.push(group);
    }
  }
  return { readyWithdrawals, pendingWithdrawals };
}

function sumCkb(items: Array<{ ckbValue: bigint }>): bigint {
  return sumValues(items, (item) => item.ckbValue);
}

function sumUdt(items: Array<{ udtValue: bigint }>): bigint {
  return sumValues(items, (item) => item.udtValue);
}

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
}
