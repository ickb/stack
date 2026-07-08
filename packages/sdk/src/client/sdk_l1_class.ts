import { ccc } from "@ckb-ccc/core";
import { ickbExchangeRatio } from "@ickb/core";
import { Info, Ratio, type OrderCell, type OrderGroup } from "@ickb/order";
import {
  collect,
  collectPagedScan,
  defaultCellPageSize,
  isPlainCapacityCell,
  unique,
} from "@ickb/utils";
import {
  addBotCkb,
  botWithdrawalCkb,
  cumulativeCkbMaturing,
  mergeBotCkb,
  poolDepositCkb,
  poolDepositsKey,
  positiveMapValueSum,
  sortDepositsByMaturity,
} from "../conversion/sdk_value_helpers.ts";
import { orderGroupWithMaturity } from "../estimate/sdk_maturity_order_group.ts";
import { IckbSdkConversion } from "./sdk_conversion_class.ts";
import { sdkManagers } from "./sdk_state_store.ts";
import type {
  AccountState,
  CkbCumulative,
  GetL1StateOptions,
  GetPoolDepositsOptions,
  MaturingCkb,
  PoolDepositState,
  SystemState,
} from "./sdk_types.ts";

/**
 * SDK layer that scans public and account L1 state.
 *
 * @public
 */
export class IckbSdkL1 extends IckbSdkConversion {
  /** Scans public iCKB pool deposits and evaluates readiness against the sampled tip. */
  public async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: GetPoolDepositsOptions,
  ): Promise<PoolDepositState> {
    const { ickbLogic } = sdkManagers(this);
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const deposits = await collect(
      ickbLogic.findDeposits(client, {
        onChain: true,
        tip,
        pageSize: cellPageSize,
        ...(options?.minLockUp === undefined ? {} : { minLockUp: options.minLockUp }),
        ...(options?.maxLockUp === undefined ? {} : { maxLockUp: options.maxLockUp }),
      }),
    );
    const readyDeposits = sortDepositsByMaturity(
      deposits.filter((deposit) => deposit.isReady),
      tip,
    );

    return { deposits, readyDeposits, id: poolDepositsKey(deposits, tip) };
  }

  /**
   * Scans account cells, receipts, withdrawal groups, and native iCKB xUDT cells.
   */
  public async getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
    options?: { cellPageSize?: number },
  ): Promise<AccountState> {
    const { ickbLogic, ownedOwner, ickbUdt } = sdkManagers(this);
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const [cells, receipts, withdrawalGroups] = await Promise.all([
      this.findAccountCells(client, locks, { pageSize: cellPageSize }),
      collect(
        ickbLogic.findReceipts(client, locks, { onChain: true, pageSize: cellPageSize }),
      ),
      collect(
        ownedOwner.findWithdrawalGroups(client, locks, {
          onChain: true,
          tip,
          pageSize: cellPageSize,
        }),
      ),
    ]);
    const nativeUdtCells = cells.filter((cell) => ickbUdt.isUdt(cell));
    const nativeUdt = nativeUdtCells.reduce(
      (acc, cell) => ({
        capacity: acc.capacity + cell.cellOutput.capacity,
        balance: acc.balance + ccc.udtBalanceFrom(cell.outputData),
      }),
      { capacity: 0n, balance: 0n },
    );

    return {
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCells,
      nativeUdtCapacity: nativeUdt.capacity,
      nativeUdtBalance: nativeUdt.balance,
      receipts,
      withdrawalGroups,
    };
  }

  /**
   * Reads system and account state using one sampled L1 system state.
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
    const { system, user } = await this.getL1State(client, locks, options);
    const account = await this.getAccountState(client, locks, system.tip, {
      ...(options?.cellPageSize === undefined
        ? {}
        : { cellPageSize: options.cellPageSize }),
    });

    return { system, user, account };
  }

  /**
   * Samples L1 system state and partitions user-owned orders from the public order pool.
   */
  public async getL1State(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }> {
    const { order } = sdkManagers(this);
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const [poolDeposits, orders, feeRate] = await Promise.all([
      this.getPoolDeposits(client, tip, { ...options?.poolDeposits, cellPageSize }),
      collect(order.findOrders(client, { onChain: true, pageSize: cellPageSize })),
      client.getFeeRate(),
    ]);
    const { ckbAvailable, ckbMaturing } = await this.getCkb(client, tip, poolDeposits, {
      cellPageSize,
    });
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
    };
  }

  private async getCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    poolDeposits: PoolDepositState,
    options: { cellPageSize: number },
  ): Promise<{ ckbAvailable: ccc.FixedPoint; ckbMaturing: CkbCumulative[] }> {
    const botCkb = await this.getBotCkbBalances(client, {
      cellPageSize: options.cellPageSize,
      tip,
    });
    const withdrawalCkb = await this.getBotWithdrawalCkb(client, tip, {
      cellPageSize: options.cellPageSize,
    });
    const poolCkb = poolDepositCkb(poolDeposits, tip);

    return {
      ckbAvailable:
        positiveMapValueSum(mergeBotCkb(botCkb, withdrawalCkb.ready)) + poolCkb.ready,
      ckbMaturing: cumulativeCkbMaturing([
        ...withdrawalCkb.maturing,
        ...poolCkb.maturing,
      ]),
    };
  }

  private async getBotCkbBalances(
    client: ccc.Client,
    options: { cellPageSize: number; tip: ccc.ClientBlockHeader },
  ): Promise<Map<string, ccc.FixedPoint>> {
    const { bots } = sdkManagers(this);
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    for (const lock of unique(bots)) {
      const cells = await this.findBotCapacityCells(client, lock, options);
      for (const cell of cells) {
        addBotCkb(bot2Ckb, lock.toHex(), cell.cellOutput.capacity);
      }
    }
    return bot2Ckb;
  }

  private async findBotCapacityCells(
    client: ccc.Client,
    lock: ccc.Script,
    options: { cellPageSize: number },
  ): Promise<ccc.Cell[]> {
    const cells = await collectPagedScan(
      (pageSize) =>
        client.findCellsOnChain(
          {
            script: lock,
            scriptType: "lock",
            filter: { scriptLenRange: [0n, 1n], outputDataLenRange: [0n, 1n] },
            scriptSearchMode: "exact",
            withData: true,
          },
          "asc",
          pageSize,
        ),
      { pageSize: options.cellPageSize },
    );
    return cells.filter(isPlainCapacityCell);
  }

  private async getBotWithdrawalCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options: { cellPageSize: number },
  ): Promise<{ ready: Map<string, ccc.FixedPoint>; maturing: MaturingCkb[] }> {
    const { bots, ownedOwner } = sdkManagers(this);
    const withdrawals = await collect(
      ownedOwner.findWithdrawalGroups(client, bots, {
        onChain: true,
        tip,
        pageSize: options.cellPageSize,
      }),
    );
    return botWithdrawalCkb(withdrawals, tip);
  }

  private async findAccountCells(
    client: ccc.Client,
    locks: ccc.Script[],
    options: { pageSize: number },
  ): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const { pageSize } = options;
    for (const lock of unique(locks)) {
      cells.push(...(await accountCellsForLock(client, lock, pageSize)));
    }
    return cells;
  }
}

function partitionOrders(
  orders: readonly OrderGroup[],
  locks: readonly ccc.Script[],
  exchangeRatio: Ratio,
): { systemOrders: OrderCell[]; userOrders: OrderGroup[] } {
  const midInfo = new Info(exchangeRatio, exchangeRatio, 1);
  const userOrders: OrderGroup[] = [];
  const systemOrders: OrderCell[] = [];
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
      systemOrders.push(order);
    }
  }
  return { systemOrders, userOrders };
}

async function accountCellsForLock(
  client: ccc.Client,
  lock: ccc.Script,
  pageSize: number,
): Promise<ccc.Cell[]> {
  return collectPagedScan(
    (requestPageSize) =>
      client.findCellsOnChain(
        { script: lock, scriptType: "lock", scriptSearchMode: "exact", withData: true },
        "asc",
        requestPageSize,
      ),
    { pageSize },
  );
}
