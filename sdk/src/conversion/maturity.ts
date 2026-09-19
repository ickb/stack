import type { ccc } from "@ckb-ccc/core";
import type { IckbDepositCell } from "../logic.ts";
import type { OrderGroup } from "../order/cells.ts";
import { fillsWhole } from "../order/fill.ts";
import type { Info } from "../order/info.ts";
import { convert, ICKB_DEPOSIT_CAP } from "../udt.ts";
import { compareBigInt, type ValueComponents } from "../utils/utils.ts";
import type { MaturityOrderInput, SystemState } from "./types.ts";

/**
 * The bot's worst-case turn: its one-minute cadence plus the confirmation wait, with room
 * for slow reads. It is the one duration the bot can be held to, so every order estimate
 * is built from it (decisions amendment 52(ai)(15)).
 */
export const BOT_TURN_MS = 10n * 60n * 1000n;

/**
 * The estimated fill time of an order on the book or about to be placed, zero when it is
 * already fulfilled. `takenDeposits` are the pool deposits the same plan withdraws
 * directly, which cannot fill its order leg too. Dual-ratio orders never reach here: the
 * scan drops them (decisions amendment 52(al)).
 */
export function maturity(
  o: MaturityOrderInput,
  system: SystemState,
  takenDeposits: readonly IckbDepositCell[] = [],
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

/** The order's terms, and its own out point when it is already on the book. */
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
    self: o.cell.outPoint,
  };
}

/**
 * A buyer waits for the bot to mint: the bot mints one cap-sized deposit per turn once its
 * iCKB inventory is spent, and the inventory is unknown here, so the wait is one turn plus
 * one per cap of net CKB demand ahead (buyers priced better than this one, less the iCKB
 * the sellers on the book bring in). One cap per worst-case turn is about 630,000 CKB an
 * hour, five to ten times slower than a normal day, deliberately: the turn is the one
 * duration the bot can be held to.
 */
function ckbToIckbOrderMaturity(
  info: Info,
  amount: bigint,
  system: SystemState,
  self: ccc.OutPoint | undefined,
): bigint {
  // An equal price counts as ahead: the bot fills ties in an order of its own choosing.
  const buyersAhead = fillableOrders(system, true, self)
    .filter((group) => group.order.data.info.ckbToUdt.compare(info.ckbToUdt) <= 0)
    .reduce((ckb, group) => ckb + group.order.ckbUnoccupied, 0n);
  const sellers = fillableOrders(system, false, self).reduce(
    (udt, group) => udt + group.udtValue,
    0n,
  );
  const demand = amount + buyersAhead - convert(false, sellers, system.exchangeRatio);
  const capCkb = convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio);
  const turns = demand > 0n ? 1n + demand / capCkb : 1n;
  return system.tip.timestamp + BOT_TURN_MS * turns;
}

/**
 * A seller waits for CKB: the bot's own working capital, one deposit's worth, unless a
 * fillable seller has already sat on the book for over a turn (then the bot has none to
 * give), plus each pool deposit at its real claim date, in claim order. The first date
 * whose supply covers this order and every seller priced at or better than it, plus one
 * turn. Every iCKB is backed by a pool deposit that matures within a cycle, so the pool
 * always covers an order at par; an order asking above par waits for the DAO ratio to
 * reach its ask, later than any claim date, and reads the pool's last claim date.
 */
function ickbToCkbOrderMaturity(
  info: Info,
  amount: bigint,
  system: SystemState,
  takenDeposits: readonly IckbDepositCell[],
  self: ccc.OutPoint | undefined,
): bigint {
  const sellers = fillableOrders(system, false, self);
  const sellersAhead = sellers
    .filter((group) => info.udtToCkb.compare(group.order.data.info.udtToCkb) <= 0)
    .reduce((udt, group) => udt + group.udtValue, 0n);
  // The CKB an order has already received belongs to its earlier fills; what it still
  // needs is the remaining iCKB at its price.
  const needed =
    info.udtToCkb.convert(false, amount, true) +
    convert(false, sellersAhead, system.exchangeRatio);
  const taken = new Set(takenDeposits.map((deposit) => deposit.cell.outPoint.toHex()));
  const steps = [
    {
      ckbValue: sellers.some((group) => sits(group, system))
        ? 0n
        : convert(false, ICKB_DEPOSIT_CAP, system.exchangeRatio),
      at: system.tip.timestamp,
    },
    ...system.poolDeposits
      .filter((deposit) => !taken.has(deposit.cell.outPoint.toHex()))
      .map((deposit) => ({
        ckbValue: deposit.ckbValue,
        at: deposit.maturity.toUnix(system.tip),
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

/** The book orders the bot would take whole in the given direction, this one aside. */
function fillableOrders(
  system: SystemState,
  isCkb2Udt: boolean,
  self: ccc.OutPoint | undefined,
): OrderGroup[] {
  return system.orderPool.filter(
    (group) =>
      !(self !== undefined && group.order.cell.outPoint.eq(self)) &&
      fillsWhole(group, isCkb2Udt, system.exchangeRatio, system.feeRate),
  );
}

/**
 * Whether the order has been on the book for more than a turn, a twenty-fourth of an
 * epoch in blocks: the bot has seen it and left it. An uncommitted origin is fresh.
 */
function sits(group: OrderGroup, { tip }: SystemState): boolean {
  return (
    group.blockNumber !== undefined &&
    tip.number - group.blockNumber > tip.epoch.denominator / 24n
  );
}
