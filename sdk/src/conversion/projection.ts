import { ccc } from "@ckb-ccc/core";
import { DAO_HEADER_INDEX_LIMIT } from "../dao.ts";
import type { OrderGroup } from "../order/cells.ts";
import type { WithdrawalGroup } from "../owned_owner.ts";
import { maxBigInt } from "../utils/utils.ts";
import { maturity } from "./maturity.ts";
import type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionTransactionContextProjection,
  SystemState,
} from "./types.ts";

/**
 * Builds the conversion planner context from account state and the caller's own orders,
 * split by what it will melt: `available` orders are collected and budgeted as account
 * value, `pending` ones stay on the book.
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
      .map((group) => maturity(group.order, system))
      .filter((estimate): estimate is bigint => estimate !== undefined),
  ].reduce(maxBigInt, system.tip.timestamp);

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
    DAO_HEADER_INDEX_LIMIT - account.receipts.length,
  );
  // An iCKB cell's capacity is the owner's CKB too: completion spends it like a plain cell.
  const ckbNative = sumValues(
    [...account.capacityCells, ...account.nativeUdtCells],
    (cell) => cell.cellOutput.capacity,
  );
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

/**
 * `ready` is the batch one transaction can complete: the deployed DAO script addresses a
 * withdrawal's deposit header only below `DAO_HEADER_INDEX_LIMIT`, and the receipts' deposit
 * headers take slots first, so matured withdrawals past the remaining slots wait a turn.
 */
function splitWithdrawals(
  withdrawalGroups: readonly WithdrawalGroup[],
  headerSlots: number,
): {
  readyWithdrawals: WithdrawalGroup[];
  pendingWithdrawals: WithdrawalGroup[];
} {
  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of withdrawalGroups) {
    if (group.owned.isReady && readyWithdrawals.length < headerSlots) {
      readyWithdrawals.push(group);
    } else {
      pendingWithdrawals.push(group);
    }
  }
  return { readyWithdrawals, pendingWithdrawals };
}

function sumCkb(items: ReadonlyArray<{ ckbValue: bigint }>): bigint {
  return sumValues(items, (item) => item.ckbValue);
}

export function sumUdt(items: ReadonlyArray<{ udtValue: bigint }>): bigint {
  return sumValues(items, (item) => item.udtValue);
}

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
}
