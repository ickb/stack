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
import { ckbFromUdt, minimumXudtCellCapacity } from "../udt.ts";
import { ceilDiv, compareBigInt } from "../utils/utils.ts";
import { maturity } from "./maturity.ts";
import type { AccountState, State, SystemState } from "./types.ts";

/*
 * The limits of one transaction. The deployed iCKB xUDT script refuses any transaction with
 * more than 2,048 inputs, of any lock or type, once an iCKB cell is among them
 * (ckb-production-scripts c/xudt_rce.c, MAX_LOCK_SCRIPT_HASH_COUNT; 2,048 passes, measured
 * on the deployed binaries, 2026-11-11). So each input kind gets a fixed share, the
 * largest first, and an account with more waits for later transactions, each compacting
 * its share: 128 collected orders (`MAX_COLLECTED_ORDERS`) and 256 ready withdrawals
 * (`DAO_HEADER_INDEX_LIMIT`), two inputs each, 128
 * receipts, 256 iCKB cells and 806 plain cells. That leaves 90 for a plan's own inputs:
 * at most 32 withdrawn pool deposits (the bot's `DAO_OUTPUT_LIMIT / 2`; a conversion's
 * 30) and the bot's at most 58
 * matched orders. sdk/node/test/bot/input_shares.ts checks the sum.
 */

/** Receipts one transaction completes. */
export const MAX_OFFERED_RECEIPTS = 128;

/** iCKB cells one transaction spends, the largest amounts first: completion spends each. */
export const MAX_OFFERED_ICKB_CELLS = 256;

/** Plain cells one transaction spends, the largest first; the rest of the 2,048 inputs. */
export const MAX_OFFERED_PLAIN_CELLS = 806;

/**
 * The most orders one transaction collects. The deployed limit_order script keeps one
 * B-tree entry per order and runs out of heap at 330 orders in the worst master out-point
 * order found, not proven the worst (383 in sorted order; 316 is the B-tree's floor;
 * ickb/contracts PR #23 pins it). So 128 keeps a 2.6x margin, and with the bot's at most
 * 58 matches a transaction holds at most 186 orders. Each melt also costs about 80k
 * cycles, far within the 3.5B of a block a node verifies a sent transaction against
 * (measured on the deployed binaries, 2026-11-10). Anyone can mint order groups whose
 * master carries a user's lock, so without a cap every rebuild would melt the same
 * over-limit set and the node would refuse it for good.
 */
export const MAX_COLLECTED_ORDERS = 128;

/**
 * The state one read projects: the sampled system, the account's positions split by what
 * the next transaction collects, and its totals. Orders the bot would take whole in neither
 * direction ({@link isCollectable}) are collected and budgeted as account value, up to
 * {@link MAX_COLLECTED_ORDERS} a transaction, past which they wait for the next; the rest
 * stay on the book. `changeLock`, the signer's recommended lock, owns the outputs a
 * conversion creates, which `ckbConvertible` sets aside.
 *
 * The next transaction is offered a fixed share of each input kind, largest first (see
 * {@link MAX_OFFERED_PLAIN_CELLS}): the balances count everything the account owns, the two
 * Maxes only what is offered.
 */
export function projectState(
  system: SystemState,
  account: AccountState,
  orders: readonly OrderGroup[],
  changeLock: ccc.Script,
): State {
  const tip = system.tip.timestamp;
  // The orders the next transaction collects, largest first, so a dust order anyone can
  // mint under the user's lock waits its turn last.
  const { ready: availableOrders, rest: pendingOrders } = takeReady(
    largestFirst(
      orders,
      (group) => group.ckbValue + ckbFromUdt(group.udtValue, system.exchangeRatio),
    ),
    (group) => readyAt(group, system) <= tip,
    MAX_COLLECTED_ORDERS,
  );
  // The deployed DAO script addresses a withdrawal's deposit header only below
  // DAO_HEADER_INDEX_LIMIT, and the builder puts those headers first, so matured
  // withdrawals past that count wait a turn.
  const { ready: readyWithdrawals, rest: pendingWithdrawals } = takeReady(
    largestFirst(account.withdrawalGroups, (group) => group.ckbValue),
    (group) => group.owned.isReady,
    DAO_HEADER_INDEX_LIMIT,
  );
  const ickbCells = largestFirst(account.nativeUdtCells, udtOf).slice(
    0,
    MAX_OFFERED_ICKB_CELLS,
  );
  const cells = [
    ...largestFirst(account.capacityCells, capacityOf).slice(0, MAX_OFFERED_PLAIN_CELLS),
    ...ickbCells,
  ];
  const receipts = largestFirst(account.receipts, (receipt) => receipt.ckbValue).slice(
    0,
    MAX_OFFERED_RECEIPTS,
  );
  // An iCKB cell's capacity is the owner's CKB too: completion spends it like a plain cell.
  const ckbNative =
    sumValues(account.capacityCells, capacityOf) +
    sumValues(account.nativeUdtCells, capacityOf);
  const ickbNative = sumValues(account.nativeUdtCells, udtOf);
  const ckbAvailable =
    ckbNative +
    sumCkb(account.receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  const ickbAvailable = ickbNative + sumUdt(account.receipts) + sumUdt(availableOrders);
  return {
    tip: system.tip,
    feeRate: system.feeRate,
    exchangeRatio: system.exchangeRatio,
    depositCapacity: system.depositCapacity,
    orderBook: system.orderBook,
    poolDeposits: system.poolDeposits,
    poolIckb: sumUdt(system.poolDeposits),
    poolCkb: sumCkb(system.poolDeposits),
    apyPercent: system.apyPercent,
    lockUp: system.lockUp,
    changeLock,
    cells,
    receipts,
    readyWithdrawals,
    pendingWithdrawals,
    availableOrders,
    pendingOrders,
    hasCollectable:
      availableOrders.length > 0 || receipts.length > 0 || readyWithdrawals.length > 0,
    ckbNative,
    ickbNative,
    ckbAvailable,
    ickbAvailable,
    ckbConvertible: convertibleCkb(
      { cells, receipts, availableOrders, readyWithdrawals },
      changeLock,
      system,
    ),
    ickbConvertible:
      sumValues(ickbCells, udtOf) + sumUdt(receipts) + sumUdt(availableOrders),
    ckbBalance: ckbAvailable + sumCkb(pendingWithdrawals) + sumCkb(pendingOrders),
    ickbBalance: ickbAvailable + sumUdt(pendingOrders),
    estimatedMaturity: ccc.numMax(
      tip,
      ...[...pendingWithdrawals, ...pendingOrders].map((position) =>
        readyAt(position, system),
      ),
    ),
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
 * The CKB a CKB-to-iCKB conversion can always spend: the offered CKB less the outputs
 * of the order-only shape, the one with the fewest cells to fund (the order cell, its
 * master, a plain and an iCKB change, the last always set aside for simplicity), and a fee
 * bound for that shape over every input the next transaction is offered, with the largest
 * supported witness. Never negative.
 *
 * @remarks The order-only shape, not a deposit: an order brings the bot the CKB it is
 * usually short of, and its 0.01% fee is earned back by DAO interest in under two days
 * (mainnet's rate was 2.0% a year in November 2026). A deposit shape would need a receipt reserve and a round-down for remainders an
 * order cannot represent.
 */
function convertibleCkb(
  {
    cells,
    receipts,
    availableOrders,
    readyWithdrawals,
  }: Pick<State, "cells" | "receipts" | "availableOrders" | "readyWithdrawals">,
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
    cells.length +
    receipts.length +
    2 * availableOrders.length +
    2 * readyWithdrawals.length;
  // Each receipt names its deposit header, each withdrawal its two, the plan its tip.
  const headerDeps = receipts.length + 2 * readyWithdrawals.length + 1;
  const size =
    TRANSACTION_FIXED_SIZE +
    LARGEST_WITNESS_SIZE +
    inputs * (CELL_INPUT_SERIALIZED_SIZE + EMPTY_WITNESS_SERIALIZATION_SIZE) +
    occupied +
    outputSizes.length *
      (CELL_OUTPUT_SERIALIZATION_OVERHEAD + OUTPUT_DATA_SERIALIZATION_OVERHEAD) +
    headerDeps * 32;
  const fee = ceilDiv(BigInt(size) * feeRate, 1000n) + FEE_MARGIN;
  const offered =
    sumValues(cells, capacityOf) +
    sumCkb(receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  return ccc.numMax(offered - BigInt(occupied) * ccc.One - fee, 0n);
}

/**
 * When a position the account holds was created and when it is collectable, in unix
 * milliseconds; a `readyAt` at or before the tip means ready now. `createdAt` is an
 * order's mint block, a withdrawal's request block, a receipt's deposit block.
 *
 * @remarks An order is dated by the state's own copy of it, found by its master, which names
 * it for its whole life: a position kept from an older read dates against this one, fills
 * since included, and one this state no longer holds, melted or filled away, is ready at
 * the tip.
 */
export function datesOf(
  state: State,
  position: OrderGroup | WithdrawalGroup | ReceiptCell,
): { createdAt: bigint; readyAt: bigint } {
  if (position instanceof OrderGroup) {
    const { outPoint } = position.master.cell;
    const current = [
      ...state.availableOrders,
      ...state.pendingOrders,
      ...state.orderBook,
    ].find((group) => group.master.cell.outPoint.eq(outPoint));
    return {
      createdAt: position.header.timestamp,
      readyAt: current === undefined ? state.tip.timestamp : readyAt(current, state),
    };
  }
  return {
    createdAt:
      position instanceof WithdrawalGroup
        ? position.owned.requestHeader.timestamp
        : position.header.timestamp,
    readyAt: readyAt(position, state),
  };
}

/**
 * When a position is collectable, never `0n`: an order the bot would take whole in neither
 * direction ({@link isCollectable}) at the tip, since the next transaction collects it,
 * else at its fill estimate, always past the tip; a withdrawal group at its claim, which
 * is at or before the tip exactly when it has matured; a receipt at its deposit block.
 * The projection's split and `estimatedMaturity` read the same formula.
 */
function readyAt(
  position: OrderGroup | WithdrawalGroup | ReceiptCell,
  system: SystemState,
): bigint {
  if (position instanceof OrderGroup) {
    return isCollectable(position, system)
      ? system.tip.timestamp
      : maturity(position.order, system);
  }
  if (position instanceof WithdrawalGroup) {
    return position.owned.claimEpoch.toUnix(system.tip);
  }
  return position.header.timestamp;
}

/**
 * The ready items, in the given order, up to `cap`, and the rest. A ready item past the cap
 * keeps its past `readyAt` and goes with the transaction after.
 */
function takeReady<T>(
  items: readonly T[],
  isReady: (item: T) => boolean,
  cap: number,
): { ready: T[]; rest: T[] } {
  const ready: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (isReady(item) && ready.length < cap) {
      ready.push(item);
    } else {
      rest.push(item);
    }
  }
  return { ready, rest };
}

function largestFirst<T>(items: readonly T[], value: (item: T) => bigint): T[] {
  return items.toSorted((left, right) => compareBigInt(value(right), value(left)));
}

function capacityOf(cell: ccc.Cell): bigint {
  return cell.cellOutput.capacity;
}

function udtOf(cell: ccc.Cell): bigint {
  return ccc.udtBalanceFrom(cell.outputData);
}

export function sumCkb(items: ReadonlyArray<{ ckbValue: bigint }>): bigint {
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
