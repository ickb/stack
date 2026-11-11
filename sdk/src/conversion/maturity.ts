import { ccc } from "@ckb-ccc/core";
import { BOT_LOCK_UP, depositMaturity } from "../dao.ts";
import type { DepositCell } from "../logic.ts";
import type { OrderCell, OrderGroup } from "../order/cells.ts";
import { fillsWhole } from "../order/fill.ts";
import type { Info } from "../order/info.ts";
import { ckbFromUdt } from "../udt.ts";
import { ceilDiv, compareBigInt, type ValueComponents } from "../utils/utils.ts";
import type { SystemState } from "./types.ts";

/**
 * Input accepted by maturity estimation, either a live order cell or raw order data plus values.
 */
export type MaturityOrderInput =
  | OrderCell
  | {
      info: Info;
      amounts: ValueComponents;
    };

/**
 * The bot's turn interval: its loop starts turns ten minutes apart, and the estimates assume it.
 * This is a modeling interval, not a bound on the runtime; see sdk/docs/pool_maturity_estimates.md.
 */
export const BOT_TURN_MS = 10n * 60n * 1000n;

/**
 * The estimated fill time of an order on the book or about to be placed, zero when it is
 * already fulfilled. `takenDeposits` are the pool deposits the same plan withdraws
 * directly, which cannot fill its order leg too. Dual-ratio orders never reach here: the
 * scan drops them.
 */
export function maturity(
  o: MaturityOrderInput,
  system: SystemState,
  takenDeposits: readonly DepositCell[] = [],
): bigint {
  const { info, amounts, self } = maturityOrderParts(o);
  const isCkb2Udt = info.isCkb2Udt();
  const amount = isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
  if (amount === 0n) {
    return 0n;
  }

  return isCkb2Udt
    ? ckbToIckbOrderMaturity(info, amount, system, self)
    : ickbToCkbOrderMaturity(info, amount, system, takenDeposits, self);
}

/**
 * The order's terms, and its master's out point when it is already on the book: the master
 * names the order for its whole life, where the order cell moves with every fill, so a copy
 * from an older read still finds itself on a newer book.
 */
function maturityOrderParts(o: MaturityOrderInput): {
  info: Info;
  amounts: ValueComponents;
  self: ccc.OutPoint | undefined;
} {
  if ("info" in o) {
    return { ...o, self: undefined };
  }

  return {
    info: o.data.info,
    amounts: { ckbValue: o.ckbUnoccupied, udtValue: o.udtValue },
    self: o.getMaster(),
  };
}

/**
 * A buyer waits for the bot to mint: the bot mints one cap-sized deposit per turn once its
 * iCKB inventory is spent, and the inventory is unknown here, so the wait is one turn plus
 * one per whole cap of positive net CKB demand (this request and buyers priced at least
 * as well, less the iCKB sellers bring in). The model does not measure the bot's funds.
 */
function ckbToIckbOrderMaturity(
  info: Info,
  amount: bigint,
  system: SystemState,
  self: ccc.OutPoint | undefined,
): bigint {
  // An equal price counts as ahead: the bot fills ties in an order of its own choosing.
  const buyersAhead = fillableOrders(system, true)
    .filter(isOther(self))
    .filter((group) => group.order.data.info.ckbToUdt.compare(info.ckbToUdt) <= 0)
    .reduce((ckb, group) => ckb + group.order.ckbUnoccupied, 0n);
  const sellers = fillableOrders(system, false)
    .filter(isOther(self))
    .reduce((udt, group) => udt + group.udtValue, 0n);
  const demand = amount + buyersAhead - ckbFromUdt(sellers, system.exchangeRatio);
  const turns = 1n + ccc.numMax(demand, 0n) / system.depositCapacity;
  return system.tip.timestamp + BOT_TURN_MS * turns;
}

/**
 * A seller waits for CKB: one deposit's worth of assumed working capital, zeroed when
 * a fillable seller, this one included, has sat beyond the threshold, plus dated pool supply. Return
 * the first date covering demand, plus a turn. Insufficient supply falls back to the last
 * date, which waits on no DAO growth: the pool always covers an ask at or below par, and
 * an ask above par is never fillable whole, so it is collected rather than dated.
 */
function ickbToCkbOrderMaturity(
  info: Info,
  amount: bigint,
  system: SystemState,
  takenDeposits: readonly DepositCell[],
  self: ccc.OutPoint | undefined,
): bigint {
  const fillableSellers = fillableOrders(system, false);
  const sellersAhead = fillableSellers
    .filter(isOther(self))
    .filter((group) => info.udtToCkb.compare(group.order.data.info.udtToCkb) <= 0)
    .reduce((udt, group) => udt + group.udtValue, 0n);
  // The CKB an order has already received belongs to its earlier fills; what it still
  // needs is the remaining iCKB at its price.
  const needed =
    ceilDiv(amount * info.udtToCkb.udtScale, info.udtToCkb.ckbScale) +
    ckbFromUdt(sellersAhead, system.exchangeRatio);
  const taken = new Set(takenDeposits.map((deposit) => deposit.cell.outPoint.toHex()));
  const steps = [
    {
      // This order counts too: a seller the bot keeps leaving shows the shortage as well.
      ckbValue: fillableSellers.some((group) => sits(group, system))
        ? 0n
        : system.depositCapacity,
      at: system.tip.timestamp,
    },
    // A claim the bot can no longer request in time rolls a cycle: the bot's rule, not the
    // caller's, since the bot is the one making the requests.
    ...system.poolDeposits
      .filter((deposit) => !taken.has(deposit.cell.outPoint.toHex()))
      .map((deposit) => ({
        ckbValue: deposit.ckbValue,
        at: depositMaturity(deposit.claimEpoch, system.tip, BOT_LOCK_UP).maturity.toUnix(
          system.tip,
        ),
      }))
      .toSorted((left, right) => compareBigInt(left.at, right.at)),
  ];
  let supply = 0n;
  let at = system.tip.timestamp;
  for (const step of steps) {
    supply += step.ckbValue;
    at = step.at;
    if (supply >= needed) {
      break;
    }
  }
  return at + BOT_TURN_MS;
}

/** The book orders the bot would take whole in the given direction. */
function fillableOrders(system: SystemState, isCkb2Udt: boolean): OrderGroup[] {
  return system.orderBook.filter((group) =>
    fillsWhole(group, isCkb2Udt, system.exchangeRatio, system.feeRate),
  );
}

/** Leaves out the order being dated, by its master, when it is already on the book. */
function isOther(self: ccc.OutPoint | undefined): (group: OrderGroup) => boolean {
  return (group) => self === undefined || !group.master.cell.outPoint.eq(self);
}

/**
 * Whether the order has gone unfilled for more than an eighth of an epoch in blocks, about
 * three ten-minute turns, since it was placed or last filled: the bot has seen it and left
 * it. A turn alone left no margin, since an order placed just after a turn waits a turn to
 * be seen, and a failed turn adds the restart delay. Counting from the last fill keeps an
 * order the bot fills a little every turn from reading as a shortage.
 */
function sits(group: OrderGroup, { tip }: SystemState): boolean {
  return tip.number - group.order.blockNumber > tip.epoch.denominator / 8n;
}
