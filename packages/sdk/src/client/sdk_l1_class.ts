import { ccc } from "@ckb-ccc/core";
import { ickbExchangeRatio } from "@ickb/core";
import { Info, Ratio, type OrderGroup } from "@ickb/order";
import {
  collect,
  collectCellsPaged,
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
} from "../conversion/sdk_value_helpers.ts";
import { orderGroupWithMaturity } from "../estimate/sdk_maturity_order_group.ts";
import { IckbSdkConversion } from "./sdk_conversion_class.ts";
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
 */
export class IckbSdkL1 extends IckbSdkConversion {
  /** Scans public iCKB pool deposits and evaluates readiness against the sampled tip. */
  public async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: GetPoolDepositsOptions,
  ): Promise<PoolDepositState> {
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const deposits = await collect(
      this.ickbLogic.findDeposits(client, {
        onChain: true,
        tip,
        pageSize: cellPageSize,
        ...(options?.minLockUp === undefined ? {} : { minLockUp: options.minLockUp }),
        ...(options?.maxLockUp === undefined ? {} : { maxLockUp: options.maxLockUp }),
      }),
    );
    return { deposits, id: poolDepositsKey(deposits, tip) };
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
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const [capacityCells, nativeUdtCells, receipts, withdrawalGroups] = await Promise.all(
      [
        this.findAccountCapacityCells(client, locks, { pageSize: cellPageSize }),
        this.findAccountNativeUdtCells(client, locks, { pageSize: cellPageSize }),
        collect(
          this.ickbLogic.findReceipts(client, locks, {
            onChain: true,
            pageSize: cellPageSize,
          }),
        ),
        collect(
          this.ownedOwner.findWithdrawalGroups(client, locks, {
            onChain: true,
            tip,
            pageSize: cellPageSize,
          }),
        ),
      ],
    );
    const nativeUdt = nativeUdtCells.reduce(
      (acc, cell) => ({
        capacity: acc.capacity + cell.cellOutput.capacity,
        balance: acc.balance + ccc.udtBalanceFrom(cell.outputData),
      }),
      { capacity: 0n, balance: 0n },
    );

    return {
      capacityCells,
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
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    const [poolDeposits, orders, feeRate] = await Promise.all([
      this.getPoolDeposits(client, tip, { ...options?.poolDeposits, cellPageSize }),
      collect(this.order.findOrders(client, { onChain: true, pageSize: cellPageSize })),
      getFeeRate(client),
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
    const [botCkb, withdrawalCkb] = await Promise.all([
      this.getBotCkbBalances(client, {
        cellPageSize: options.cellPageSize,
        tip,
      }),
      this.getBotWithdrawalCkb(client, tip, {
        cellPageSize: options.cellPageSize,
      }),
    ]);
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
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    for (const lock of unique(this.bots)) {
      const cells = await this.findPlainCapacityCells(client, lock, options.cellPageSize);
      for (const cell of cells) {
        addBotCkb(bot2Ckb, lock.toHex(), cell.cellOutput.capacity);
      }
    }
    return bot2Ckb;
  }

  private async findPlainCapacityCells(
    client: ccc.Client,
    lock: ccc.Script,
    pageSize: number,
  ): Promise<ccc.Cell[]> {
    const cells = await collectCellsPaged(
      client,
      {
        script: lock,
        scriptType: "lock",
        filter: { scriptLenRange: [0n, 1n], outputDataLenRange: [0n, 1n] },
        scriptSearchMode: "exact",
        withData: true,
      },
      "asc",
      { onChain: true, pageSize },
    );
    return cells.filter(
      (cell) => cell.cellOutput.lock.eq(lock) && isPlainCapacityCell(cell),
    );
  }

  private async getBotWithdrawalCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options: { cellPageSize: number },
  ): Promise<{ ready: Map<string, ccc.FixedPoint>; maturing: MaturingCkb[] }> {
    const withdrawals = await collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, {
        onChain: true,
        tip,
        pageSize: options.cellPageSize,
      }),
    );
    return botWithdrawalCkb(withdrawals, tip);
  }

  private async findAccountCapacityCells(
    client: ccc.Client,
    locks: ccc.Script[],
    options: { pageSize: number },
  ): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const { pageSize } = options;
    for (const lock of unique(locks)) {
      cells.push(...(await this.findPlainCapacityCells(client, lock, pageSize)));
    }
    return cells;
  }

  private async findAccountNativeUdtCells(
    client: ccc.Client,
    locks: ccc.Script[],
    options: { pageSize: number },
  ): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const scriptSize = BigInt(this.ickbUdt.script.occupiedSize);
    for (const lock of unique(locks)) {
      const found = await collectCellsPaged(
        client,
        {
          script: lock,
          scriptType: "lock",
          filter: {
            script: this.ickbUdt.script,
            scriptLenRange: [scriptSize, scriptSize + 1n],
          },
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        { onChain: true, pageSize: options.pageSize },
      );
      cells.push(
        ...found.filter(
          (cell) =>
            cell.cellOutput.lock.eq(lock) &&
            cell.cellOutput.type?.eq(this.ickbUdt.script) === true &&
            this.ickbUdt.isUdt(cell),
        ),
      );
    }
    return cells;
  }
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
