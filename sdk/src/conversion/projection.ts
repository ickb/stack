import { ccc } from "@ckb-ccc/core";
import { DAO_HEADER_INDEX_LIMIT } from "../dao.ts";
import type { ReceiptCell } from "../logic.ts";
import { OrderGroup } from "../order/cells.ts";
import {
  CELL_INPUT_SERIALIZED_SIZE,
  CELL_OUTPUT_SERIALIZATION_OVERHEAD,
  EMPTY_WITNESS_SERIALIZATION_SIZE,
  OUTPUT_DATA_SERIALIZATION_OVERHEAD,
} from "../order/fee.ts";
import { isCollectable } from "../order/fill.ts";
import { WithdrawalGroup } from "../owned_owner.ts";
import { minimumXudtCellCapacity } from "../udt.ts";
import { ceilDiv } from "../utils/utils.ts";
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
 * ({@link isCollectable}) are collected and budgeted as account value, up to
 * {@link MAX_COLLECTED_ORDERS} a transaction, past which they wait for the next; the rest
 * stay on the book. `changeLock`, the signer's recommended lock, owns the outputs a conversion
 * creates, which `ckbConvertible` sets aside.
 */
export function projectConversionTransactionContext(
  system: SystemState,
  account: AccountState,
  orders: readonly OrderGroup[],
  changeLock: ccc.Script,
): ConversionTransactionContextProjection {
  const tip = system.tip.timestamp;
  const availability = projectAccountAvailability(
    account,
    splitOrders(orders, (group) => readyAt(group, system) <= tip),
  );
  const projection = {
    ...availability,
    ckbConvertible: convertibleCkb(account, availability, changeLock, system),
  };
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

// An order cell: capacity, the order lock (code hash and hash type, no args), the iCKB
// xUDT type and the mint's order data. Both deployments size these scripts alike.
const ORDER_CELL_SIZE = 8 + 33 + 69 + 89;
// A master's type is the order script.
const ORDER_SCRIPT_SIZE = 33;
// The largest witness a supported wallet signs with: JoyID's, under a thousand bytes.
const LARGEST_WITNESS_SIZE = 1000;
// The transaction's own fields and every cell dep the SDK or a signer adds, generously.
const TRANSACTION_FIXED_SIZE = 1000;
// What the size bound may still miss, at any fee rate a wallet plans at.
const FEE_MARGIN = ccc.One;

/**
 * The CKB a CKB-to-iCKB conversion can always spend: the available CKB less the outputs
 * of the order-only shape, the one with the fewest cells to fund (the order cell, its
 * master, a plain and an iCKB change, the last always set aside for simplicity), and a fee
 * bound for that shape over every input the account offers, with the largest supported
 * witness. Never negative.
 *
 * @remarks The order-only shape, not a deposit: an order brings the bot the CKB it is
 * usually short of, and its 0.01% fee is earned back by DAO interest in under two days
 * (mainnet's rate was 2.0% a year in November 2026). A deposit shape would need a receipt reserve and a round-down for remainders an
 * order cannot represent.
 */
function convertibleCkb(
  account: AccountState,
  {
    ckbAvailable,
    availableOrders,
    readyWithdrawals,
  }: Omit<AccountAvailabilityProjection, "ckbConvertible">,
  changeLock: ccc.Script,
  { feeRate }: SystemState,
): bigint {
  const lockSize = changeLock.occupiedSize;
  const outputSizes = [
    ORDER_CELL_SIZE,
    8 + lockSize + ORDER_SCRIPT_SIZE,
    8 + lockSize,
    Number(minimumXudtCellCapacity(changeLock) / ccc.One),
  ];
  const occupied = outputSizes.reduce((sum, size) => sum + size, 0);
  const inputs =
    account.capacityCells.length +
    account.nativeUdtCells.length +
    account.receipts.length +
    2 * availableOrders.length +
    2 * readyWithdrawals.length;
  // Each receipt names its deposit header, each withdrawal its two, the plan its tip.
  const headerDeps = account.receipts.length + 2 * readyWithdrawals.length + 1;
  const size =
    TRANSACTION_FIXED_SIZE +
    LARGEST_WITNESS_SIZE +
    inputs * (CELL_INPUT_SERIALIZED_SIZE + EMPTY_WITNESS_SERIALIZATION_SIZE) +
    occupied +
    outputSizes.length *
      (CELL_OUTPUT_SERIALIZATION_OVERHEAD + OUTPUT_DATA_SERIALIZATION_OVERHEAD) +
    headerDeps * 32;
  const fee = ceilDiv(BigInt(size) * feeRate, 1000n) + FEE_MARGIN;
  const convertible = ckbAvailable - BigInt(occupied) * ccc.One - fee;
  return convertible > 0n ? convertible : 0n;
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
): Omit<AccountAvailabilityProjection, "ckbConvertible"> {
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
 * The most orders one transaction collects. The deployed limit_order script keeps one
 * B-tree entry per order and runs out of heap at 330 orders in the worst master out-point
 * order we could construct (383 in sorted order; 316 is the B-tree's floor), so 128 keeps
 * a 2.6x margin; each melt also costs about 80k of the 70M cycles a node verifies per
 * transaction (measured on the deployed binaries, 2026-11-10). Anyone can mint order groups whose
 * master carries a user's lock, so without a cap every rebuild would melt the same
 * over-limit set and the node would refuse it for good.
 */
const MAX_COLLECTED_ORDERS = 128;

/**
 * `available` is the orders the next transaction collects: the ready ones, in scan order,
 * up to {@link MAX_COLLECTED_ORDERS}. A ready order past the cap keeps its past `readyAt`
 * and is collected by the transaction after, as a matured withdrawal past its cap is.
 */
function splitOrders(
  orders: readonly OrderGroup[],
  isReady: (group: OrderGroup) => boolean,
): { available: OrderGroup[]; pending: OrderGroup[] } {
  const available: OrderGroup[] = [];
  const pending: OrderGroup[] = [];
  for (const group of orders) {
    if (isReady(group) && available.length < MAX_COLLECTED_ORDERS) {
      available.push(group);
    } else {
      pending.push(group);
    }
  }
  return { available, pending };
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
