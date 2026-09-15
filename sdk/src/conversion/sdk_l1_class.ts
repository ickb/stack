import { ccc } from "@ckb-ccc/core";
import {
  ickbExchangeRatio,
  type ReceiptCell,
  type WithdrawalGroup,
} from "../core/index.ts";
import { Info, Ratio, type OrderGroup } from "../order/index.ts";
import { collect, findCells, isPlainCapacityCell, unique } from "../utils/index.ts";
import { IckbSdkConversion } from "./sdk_conversion_class.ts";
import { orderGroupWithMaturity } from "./sdk_maturity_order_group.ts";
import type {
  AccountState,
  GetL1StateOptions,
  MaturingCkb,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./sdk_types.ts";
import { cumulativeCkbMaturing, poolDepositCkb } from "./sdk_value_helpers.ts";

/** Plain CKB each known bot keeps for its own cells and fees, excluded from the maturity estimate. */
const botCkbReserve = ccc.fixedPointFrom("2000");

/** Every Stack cell one lock owns, classified from a single exact-lock scan. */
interface LockCells {
  lock: ccc.Script;
  capacityCells: ccc.Cell[];
  nativeUdtCells: ccc.Cell[];
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroup[];
}

/**
 * SDK layer that reads public and account L1 state.
 *
 * @remarks Every read is complete and uncapped: a large book or pool costs a
 * slower read, never a partial or failed one. Each account lock and each known
 * bot lock is enumerated by one uncached unfiltered exact-lock scan and
 * classified client-side, so the account read and the bot maturity estimate
 * share one observation of the same cells (decisions amendment 52).
 */
export class IckbSdkL1 extends IckbSdkConversion {
  /**
   * Reads system, user-order, and account state against one sampled tip.
   */
  public async getL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }> {
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const [poolDeposits, orders, feeRate, lockCells] = await Promise.all([
      this.getPoolDeposits(client, tip, options?.poolDeposits),
      collect(this.order.findOrders(client)),
      getFeeRate(client),
      Promise.all(
        [...unique([...locks, ...this.bots])].map(async (lock) =>
          this.readLockCells(client, lock, tip),
        ),
      ),
    ]);
    const { ckbAvailable, ckbMaturing } = this.ckbProjection(
      lockCells,
      poolDeposits,
      tip,
    );
    const { systemOrders, userOrders } = partitionOrders(orders, locks, exchangeRatio);
    const system = {
      feeRate,
      tip,
      exchangeRatio,
      orderPool: systemOrders,
      ckbAvailable,
      ckbMaturing,
      poolDeposits,
    };
    return {
      system,
      user: { orders: userOrders.map((group) => orderGroupWithMaturity(group, system)) },
      account: accountState(
        lockCells.filter(({ lock }) => locks.some((l) => l.eq(lock))),
      ),
    };
  }

  private async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    range?: PoolDepositRangeOptions,
  ): Promise<PoolDepositState> {
    const deposits = await collect(
      this.ickbLogic.findDeposits(client, {
        tip,
        ...(range?.minLockUp === undefined ? {} : { minLockUp: range.minLockUp }),
        ...(range?.maxLockUp === undefined ? {} : { maxLockUp: range.maxLockUp }),
      }),
    );
    return { deposits };
  }

  private async readLockCells(
    client: ccc.Client,
    lock: ccc.Script,
    tip: ccc.ClientBlockHeader,
  ): Promise<LockCells> {
    const cells = await findCells(client, {
      script: lock,
      scriptType: "lock",
      scriptSearchMode: "exact",
      withData: true,
    });
    const [receipts, withdrawalGroups] = await Promise.all([
      this.ickbLogic.receiptsFrom(client, cells),
      this.ownedOwner.withdrawalGroupsFrom(client, cells, tip),
    ]);
    return {
      lock,
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCells: cells.filter((cell) => this.ickbUdt.isUdt(cell)),
      receipts,
      withdrawalGroups,
    };
  }

  /** CKB the system can pay out: ready pool deposits plus each known bot's spendable CKB. */
  private ckbProjection(
    lockCells: readonly LockCells[],
    poolDeposits: PoolDepositState,
    tip: ccc.ClientBlockHeader,
  ): Pick<SystemState, "ckbAvailable" | "ckbMaturing"> {
    const poolCkb = poolDepositCkb(poolDeposits, tip);
    let ckbAvailable = poolCkb.ready;
    const maturing: MaturingCkb[] = [...poolCkb.maturing];
    for (const bot of lockCells.filter(({ lock }) => this.bots.some((b) => b.eq(lock)))) {
      let ready = -botCkbReserve;
      for (const cell of bot.capacityCells) {
        ready += cell.cellOutput.capacity;
      }
      for (const group of bot.withdrawalGroups) {
        if (group.owned.isReady) {
          ready += group.ckbValue;
        } else {
          maturing.push({
            ckbValue: group.ckbValue,
            maturity: group.owned.maturity.toUnix(tip),
          });
        }
      }
      if (ready > 0n) {
        ckbAvailable += ready;
      }
    }
    return { ckbAvailable, ckbMaturing: cumulativeCkbMaturing(maturing) };
  }
}

function accountState(lockCells: readonly LockCells[]): AccountState {
  const nativeUdtCells = lockCells.flatMap((cells) => cells.nativeUdtCells);
  return {
    capacityCells: lockCells.flatMap((cells) => cells.capacityCells),
    nativeUdtCells,
    nativeUdtCapacity: nativeUdtCells.reduce(
      (sum, cell) => sum + cell.cellOutput.capacity,
      0n,
    ),
    nativeUdtBalance: nativeUdtCells.reduce(
      (sum, cell) => sum + ccc.udtBalanceFrom(cell.outputData),
      0n,
    ),
    receipts: lockCells.flatMap((cells) => cells.receipts),
    withdrawalGroups: lockCells.flatMap((cells) => cells.withdrawalGroups),
  };
}

function partitionOrders(
  orders: readonly OrderGroup[],
  locks: readonly ccc.Script[],
  exchangeRatio: Ratio,
): { systemOrders: OrderGroup[]; userOrders: OrderGroup[] } {
  const midInfo = new Info(exchangeRatio, exchangeRatio, 1);
  const userOrders: OrderGroup[] = [];
  const systemOrders: OrderGroup[] = [];
  for (const group of orders) {
    if (group.isOwner(...locks)) {
      userOrders.push(group);
      continue;
    }
    const { order } = group;
    const info = order.data.info;
    if (
      (order.isCkb2UdtMatchable() && info.ckb2UdtCompare(midInfo) < 0) ||
      (order.isUdt2CkbMatchable() && info.udt2CkbCompare(midInfo) < 0)
    ) {
      systemOrders.push(group);
    }
  }
  return { systemOrders, userOrders };
}

async function getFeeRate(client: ccc.Client): Promise<ccc.Num> {
  const feeRate = await client.getFeeRate();
  if (feeRate < 0n) {
    throw new Error("Client fee rate must be non-negative");
  }
  return feeRate;
}
