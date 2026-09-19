import type { ccc } from "@ckb-ccc/core";
import {
  ickbExchangeRatio,
  type ReceiptCell,
  type WithdrawalGroup,
} from "../core/index.ts";
import type { OrderGroup } from "../order/cells.ts";
import { Ratio } from "../order/ratio.ts";
import { collect, findCells, isPlainCapacityCell, unique } from "../utils/index.ts";
import { IckbSdkConversion } from "./sdk_conversion_class.ts";
import type {
  AccountState,
  GetL1StateOptions,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./sdk_types.ts";
import { cumulativeCkbMaturing, poolDepositCkb } from "./sdk_value_helpers.ts";

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
 * slower read, never a partial or failed one. Each account lock is enumerated
 * by one uncached unfiltered exact-lock scan and classified client-side
 * (decisions amendment 52).
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
      this.order.findOrders(client),
      getFeeRate(client),
      Promise.all(
        [...unique(locks)].map(async (lock) => this.readLockCells(client, lock, tip)),
      ),
    ]);
    // The CKB that can fill orders is the public pool: ready deposits now, the rest at maturity.
    const poolCkb = poolDepositCkb(poolDeposits, tip);
    const { systemOrders, userOrders } = partitionOrders(orders, locks, exchangeRatio);
    const system = {
      feeRate,
      tip,
      exchangeRatio,
      orderPool: systemOrders,
      ckbAvailable: poolCkb.ready,
      ckbMaturing: cumulativeCkbMaturing(poolCkb.maturing),
      poolDeposits,
    };
    return {
      system,
      user: { orders: userOrders },
      account: accountState(lockCells),
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
}

function accountState(lockCells: readonly LockCells[]): AccountState {
  return {
    capacityCells: lockCells.flatMap((cells) => cells.capacityCells),
    nativeUdtCells: lockCells.flatMap((cells) => cells.nativeUdtCells),
    receipts: lockCells.flatMap((cells) => cells.receipts),
    withdrawalGroups: lockCells.flatMap((cells) => cells.withdrawalGroups),
  };
}

function partitionOrders(
  orders: readonly OrderGroup[],
  locks: readonly ccc.Script[],
  exchangeRatio: Ratio,
): { systemOrders: OrderGroup[]; userOrders: OrderGroup[] } {
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
      (order.isCkb2UdtMatchable() && info.ckbToUdt.compare(exchangeRatio) < 0) ||
      (order.isUdt2CkbMatchable() && exchangeRatio.compare(info.udtToCkb) < 0)
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
