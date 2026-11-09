import { ccc } from "@ckb-ccc/core";
import { DAO_HEADER_INDEX_LIMIT } from "../dao.ts";
import type { ReceiptCell } from "../logic.ts";
import { OrderGroup } from "../order/cells.ts";
import { isCollectable } from "../order/fill.ts";
import { WithdrawalGroup } from "../owned_owner.ts";
import { maturity } from "./maturity.ts";
import type {
  AccountAvailabilityProjection,
  AccountState,
  ConversionTransactionContextProjection,
  SystemState,
} from "./types.ts";

/**
 * Builds the conversion planner context from account state and the caller's own orders,
 * split by what it will melt: orders the bot would take whole in neither direction
 * ({@link isCollectable}) are collected and budgeted as account value; the rest stay on
 * the book.
 */
export function projectConversionTransactionContext(
  system: SystemState,
  account: AccountState,
  orders: readonly OrderGroup[],
): ConversionTransactionContextProjection {
  const tip = system.tip.timestamp;
  const isReady = (group: OrderGroup): boolean => readyAt(group, system) <= tip;
  const projection = projectAccountAvailability(account, {
    available: orders.filter(isReady),
    pending: orders.filter((group) => !isReady(group)),
  });
  const estimatedMaturity = ccc.numMax(
    tip,
    ...[...projection.pendingWithdrawals, ...projection.pendingOrders].map((position) =>
      readyAt(position, system),
    ),
  );

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
 * When a position the account holds is collectable, in unix milliseconds: `0n` or a time
 * at or before the tip means now. An order is ready when the bot would take it whole in
 * neither direction ({@link isCollectable}), since the next transaction collects it, else
 * at its fill estimate, always past the tip; a withdrawal group at its claim, which is at
 * or before the tip exactly when it has matured; a receipt at once.
 */
export function readyAt(
  position: OrderGroup | WithdrawalGroup | ReceiptCell,
  system: SystemState,
): bigint {
  if (position instanceof OrderGroup) {
    return isCollectable(position, system) ? 0n : maturity(position.order, system);
  }
  if (position instanceof WithdrawalGroup) {
    return position.owned.maturity.toUnix(system.tip);
  }
  return 0n;
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
 * withdrawal's deposit header only below `DAO_HEADER_INDEX_LIMIT`, and the builder puts
 * those headers first, so matured withdrawals past that count wait a turn. A group past
 * the cap keeps its past `readyAt` and completes with the next transaction.
 */
function splitWithdrawals(withdrawalGroups: readonly WithdrawalGroup[]): {
  readyWithdrawals: WithdrawalGroup[];
  pendingWithdrawals: WithdrawalGroup[];
} {
  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of withdrawalGroups) {
    if (group.owned.isReady && readyWithdrawals.length < DAO_HEADER_INDEX_LIMIT) {
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
