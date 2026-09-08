import { ccc } from "@ckb-ccc/core";
import {
  addBotCkb,
  botWithdrawalCkb,
  cumulativeCkbMaturing,
  mergeBotCkb,
  poolDepositCkb,
  poolDepositsKey,
  positiveMapValueSum,
} from "../conversion/sdk_value_helpers.ts";
import { ickbExchangeRatio } from "../core/index.ts";
import { orderGroupWithMaturity } from "../estimate/sdk_maturity_order_group.ts";
import { Info, Ratio, type OrderGroup } from "../order/index.ts";
import { collect, findCells, isPlainCapacityCell, unique } from "../utils/index.ts";
import { IckbSdkConversion } from "./sdk_conversion_class.ts";
import type {
  AccountState,
  CkbCumulative,
  GetL1StateOptions,
  MaturingCkb,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./sdk_types.ts";

/**
 * SDK layer that reads public and account L1 state.
 *
 * @remarks Every read is complete and uncapped: a large book or pool costs a
 * slower read, never a partial or failed one (decisions amendment 52).
 */
export class IckbSdkL1 extends IckbSdkConversion {
  /**
   * Reads public iCKB pool deposits and evaluates readiness against the sampled tip.
   */
  public async getPoolDeposits(
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
    return { deposits, id: poolDepositsKey(deposits, tip) };
  }

  /**
   * Reads account cells, receipts, withdrawal groups, and native iCKB xUDT cells.
   */
  public async getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
  ): Promise<AccountState> {
    const [liquidCells, receipts, withdrawalGroups] = await Promise.all([
      this.findAccountLiquidCells(client, locks),
      collect(this.ickbLogic.findReceipts(client, locks)),
      collect(this.ownedOwner.findWithdrawalGroups(client, locks, { tip })),
    ]);
    const capacityCells = liquidCells.filter(isPlainCapacityCell);
    const nativeUdtCells = liquidCells.filter((cell) => this.ickbUdt.isUdt(cell));
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
    const account = await this.getAccountState(client, locks, system.tip);
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
    const [poolDeposits, orders, feeRate] = await Promise.all([
      this.getPoolDeposits(client, tip, options?.poolDeposits),
      collect(this.order.findOrders(client)),
      getFeeRate(client),
    ]);
    const { ckbAvailable, ckbMaturing } = await this.getCkb(client, tip, poolDeposits);
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
  ): Promise<{ ckbAvailable: ccc.FixedPoint; ckbMaturing: CkbCumulative[] }> {
    const [botCkb, withdrawalCkb] = await Promise.all([
      this.getBotCkbBalances(client),
      this.getBotWithdrawalCkb(client, tip),
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
  ): Promise<Map<string, ccc.FixedPoint>> {
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    for (const lock of unique(this.bots)) {
      const cells = await this.findPlainCapacityCells(client, lock);
      for (const cell of cells) {
        addBotCkb(bot2Ckb, lock.toHex(), cell.cellOutput.capacity);
      }
    }
    return bot2Ckb;
  }

  private async findPlainCapacityCells(
    client: ccc.Client,
    lock: ccc.Script,
  ): Promise<ccc.Cell[]> {
    const cells = await findCells(client, {
      script: lock,
      scriptType: "lock",
      filter: { scriptLenRange: [0n, 1n], outputDataLenRange: [0n, 1n] },
      scriptSearchMode: "exact",
      withData: true,
    });
    return cells.filter(isPlainCapacityCell);
  }

  private async getBotWithdrawalCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
  ): Promise<{ ready: Map<string, ccc.FixedPoint>; maturing: MaturingCkb[] }> {
    const withdrawals = await collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, { tip }),
    );
    return botWithdrawalCkb(withdrawals, tip);
  }

  private async findAccountLiquidCells(
    client: ccc.Client,
    locks: ccc.Script[],
  ): Promise<ccc.Cell[]> {
    const liquidCells: ccc.Cell[] = [];
    // One exact-lock scan per distinct lock: a cell has one lock, so no cell repeats.
    for (const lock of unique(locks)) {
      const cells = await findCells(client, {
        script: lock,
        scriptType: "lock",
        scriptSearchMode: "exact",
        withData: true,
      });
      liquidCells.push(
        ...cells.filter((cell) => isPlainCapacityCell(cell) || this.ickbUdt.isUdt(cell)),
      );
    }
    return liquidCells;
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
