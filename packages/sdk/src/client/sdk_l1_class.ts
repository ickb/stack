import { ccc } from "@ckb-ccc/core";
import { ickbExchangeRatio } from "@ickb/core";
import { Info, Ratio, type OrderGroup } from "@ickb/order";
import {
  collect,
  collectCellsPaged,
  defaultCellPageSize,
  defaultScanBudget,
  isPlainCapacityCell,
  PagedScanBudgetError,
  PagedScanCursorError,
  unique,
  type PagedScanBudget,
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
import { IckbError } from "./sdk_error.ts";
import type {
  AccountState,
  CkbCumulative,
  GetL1StateOptions,
  GetPoolDepositsOptions,
  MaturingCkb,
  PoolDepositRangeOptions,
  PoolDepositState,
  SystemState,
} from "./sdk_types.ts";

/** Options shared by the components of one composed L1 scan. */
interface ScanOptions {
  cellPageSize: number;
  budget: PagedScanBudget;
}

/**
 * SDK layer that scans public and account L1 state.
 *
 */
export class IckbSdkL1 extends IckbSdkConversion {
  /**
   * Scans public iCKB pool deposits and evaluates readiness against the sampled tip.
   *
   * @remarks The scan is bounded on its own; it fails rather than returning a
   * partial pool. `signal` cancels it without returning partial state.
   */
  public async getPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    options?: GetPoolDepositsOptions,
  ): Promise<PoolDepositState> {
    const scan = this.scanOptions(options);
    return boundedL1Scan(
      async () => this.scanPoolDeposits(client, tip, scan, options),
      options?.signal,
    );
  }

  /**
   * Scans account cells, receipts, withdrawal groups, and native iCKB xUDT cells.
   *
   * @remarks All component scans share one bound and fail together, so account
   * state is never returned partially. `signal` cancels the whole scan.
   */
  public async getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
    options?: { cellPageSize?: number; signal?: AbortSignal },
  ): Promise<AccountState> {
    const scan = this.scanOptions(options);
    return boundedL1Scan(
      async () => this.scanAccountState(client, locks, tip, scan),
      options?.signal,
    );
  }

  /**
   * Reads system and account state using one sampled L1 system state.
   *
   * @remarks System and account components share one bound and one `signal`, so
   * the whole read fails or cancels rather than mixing complete system state
   * with partial account state.
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
    const scan = this.scanOptions(options);
    return boundedL1Scan(
      async () => this.scanL1AccountState(client, locks, scan, options),
      options?.signal,
    );
  }

  /**
   * Samples L1 system state and partitions user-owned orders from the public order pool.
   *
   * @remarks Pool deposit, order, and bot scans share one bound and one
   * `signal`, so system state is never returned partially.
   */
  public async getL1State(
    client: ccc.Client,
    locks: ccc.Script[],
    options?: GetL1StateOptions,
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }> {
    const scan = this.scanOptions(options);
    return boundedL1Scan(
      async () => this.scanL1State(client, locks, scan, options),
      options?.signal,
    );
  }

  private async scanL1AccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    scan: ScanOptions,
    options?: GetL1StateOptions,
  ): Promise<{
    system: SystemState;
    user: { orders: OrderGroup[] };
    account: AccountState;
  }> {
    const { system, user } = await this.scanL1State(client, locks, scan, options);
    const account = await this.scanAccountState(client, locks, system.tip, scan);

    return { system, user, account };
  }

  private async scanAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
    options: ScanOptions,
  ): Promise<AccountState> {
    const { cellPageSize, budget } = options;
    const [liquidCells, receipts, withdrawalGroups] = await Promise.all([
      this.findAccountLiquidCells(client, locks, { pageSize: cellPageSize, budget }),
      collect(
        this.ickbLogic.findReceipts(client, locks, {
          onChain: true,
          pageSize: cellPageSize,
          budget,
        }),
      ),
      collect(
        this.ownedOwner.findWithdrawalGroups(client, locks, {
          onChain: true,
          tip,
          pageSize: cellPageSize,
          budget,
        }),
      ),
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

  private async scanL1State(
    client: ccc.Client,
    locks: ccc.Script[],
    scan: ScanOptions,
    options?: GetL1StateOptions,
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }> {
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));
    const [poolDeposits, orders, feeRate] = await Promise.all([
      this.scanPoolDeposits(client, tip, scan, options?.poolDeposits),
      collect(
        this.order.findOrders(client, {
          onChain: true,
          pageSize: scan.cellPageSize,
          budget: scan.budget,
        }),
      ),
      getFeeRate(client),
    ]);
    const { ckbAvailable, ckbMaturing } = await this.getCkb(
      client,
      tip,
      poolDeposits,
      scan,
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
    };
  }

  /** Builds the shared options for one composed scan. */
  private scanOptions(options?: {
    cellPageSize?: number;
    signal?: AbortSignal;
  }): ScanOptions {
    const cellPageSize = options?.cellPageSize ?? defaultCellPageSize;
    return {
      cellPageSize,
      budget: defaultScanBudget({
        pageSize: cellPageSize,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      }),
    };
  }

  private async scanPoolDeposits(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    scan: ScanOptions,
    range?: PoolDepositRangeOptions,
  ): Promise<PoolDepositState> {
    const deposits = await collect(
      this.ickbLogic.findDeposits(client, {
        onChain: true,
        tip,
        pageSize: scan.cellPageSize,
        budget: scan.budget,
        ...(range?.minLockUp === undefined ? {} : { minLockUp: range.minLockUp }),
        ...(range?.maxLockUp === undefined ? {} : { maxLockUp: range.maxLockUp }),
      }),
    );
    return { deposits, id: poolDepositsKey(deposits, tip) };
  }

  private async getCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    poolDeposits: PoolDepositState,
    scan: ScanOptions,
  ): Promise<{ ckbAvailable: ccc.FixedPoint; ckbMaturing: CkbCumulative[] }> {
    const [botCkb, withdrawalCkb] = await Promise.all([
      this.getBotCkbBalances(client, scan),
      this.getBotWithdrawalCkb(client, tip, scan),
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
    scan: ScanOptions,
  ): Promise<Map<string, ccc.FixedPoint>> {
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    for (const lock of unique(this.bots)) {
      const cells = await this.findPlainCapacityCells(client, lock, scan);
      for (const cell of cells) {
        addBotCkb(bot2Ckb, lock.toHex(), cell.cellOutput.capacity);
      }
    }
    return bot2Ckb;
  }

  private async findPlainCapacityCells(
    client: ccc.Client,
    lock: ccc.Script,
    scan: ScanOptions,
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
      { onChain: true, pageSize: scan.cellPageSize, budget: scan.budget },
    );
    return cells.filter(
      (cell) => cell.cellOutput.lock.eq(lock) && isPlainCapacityCell(cell),
    );
  }

  private async getBotWithdrawalCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
    scan: ScanOptions,
  ): Promise<{ ready: Map<string, ccc.FixedPoint>; maturing: MaturingCkb[] }> {
    const withdrawals = await collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, {
        onChain: true,
        tip,
        pageSize: scan.cellPageSize,
        budget: scan.budget,
      }),
    );
    return botWithdrawalCkb(withdrawals, tip);
  }

  private async findAccountLiquidCells(
    client: ccc.Client,
    locks: ccc.Script[],
    options: { pageSize: number; budget: PagedScanBudget },
  ): Promise<ccc.Cell[]> {
    const seen = new Set<string>();
    const liquidCells: ccc.Cell[] = [];
    for (const lock of unique(locks)) {
      const cells = await collectCellsPaged(
        client,
        {
          script: lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        { onChain: true, pageSize: options.pageSize, budget: options.budget },
      );
      for (const cell of cells) {
        if (
          !cell.cellOutput.lock.eq(lock) ||
          (!isPlainCapacityCell(cell) && !this.ickbUdt.isUdt(cell))
        ) {
          continue;
        }
        const outPoint = cell.outPoint.toHex();
        if (!seen.has(outPoint)) {
          seen.add(outPoint);
          liquidCells.push(cell);
        }
      }
    }
    return liquidCells;
  }
}

/**
 * Runs one composed scan under its signal and maps an exhausted or cancelled
 * scan to the typed SDK failure.
 *
 * @remarks The scan fails on abort even while a client request that the shared
 * budget never sees is still unresolved.
 */
async function boundedL1Scan<T>(
  startScan: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    signal?.throwIfAborted();
    const scan = startScan();
    if (signal === undefined) {
      return await scan;
    }
    // Client requests cannot be cancelled, so a scan this function stops waiting
    // on still settles and its rejection must stay handled.
    void scan.catch(ignoreSettlement);
    const stop = Promise.withResolvers<never>();
    const onAbort = (): void => {
      stop.reject(signal.reason);
    };
    void stop.promise.catch(ignoreSettlement);
    signal.addEventListener("abort", onAbort, { once: true });
    // An abort raised while the scan was starting fired before this listener
    // existed, and a cancelled scan may never settle, so it is replayed here.
    if (signal.aborted) {
      stop.reject(signal.reason);
    }
    try {
      const state = await Promise.race([scan, stop.promise]);
      // An abort after the last page must not return the state it cancelled.
      signal.throwIfAborted();
      return state;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    // Caller cancellation is the caller's own reason, whether the abort reached
    // a page budget, an awaited client request, or the end of the scan.
    signal?.throwIfAborted();
    if (error instanceof PagedScanBudgetError || error instanceof PagedScanCursorError) {
      throw new IckbError("L1 scan did not complete", {
        code: "account_scan_limit",
        cause: error,
      });
    }
    throw error;
  }
}

function ignoreSettlement(): void {
  // Deliberately empty: the racing caller owns the outcome.
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
