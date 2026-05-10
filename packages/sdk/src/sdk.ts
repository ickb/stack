import { ccc } from "@ckb-ccc/core";
import { assertDaoOutputLimit } from "@ickb/dao";
import {
  collect,
  binarySearch,
  defaultFindCellsLimit,
  isPlainCapacityCell,
  unique,
  type ValueComponents,
} from "@ickb/utils";
import {
  convert,
  type IckbDepositCell,
  type IckbUdt,
  ickbExchangeRatio,
  type LogicManager,
  type OwnedOwnerManager,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import {
  Info,
  OrderManager,
  Ratio,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";
import { getConfig } from "./constants.js";

export interface CompleteIckbTransactionOptions {
  signer: ccc.Signer;
  client: ccc.Client;
  feeRate: ccc.Num;
}

export interface SendAndWaitForCommitOptions {
  maxConfirmationChecks?: number;
  confirmationIntervalMs?: number;
  onSent?: (txHash: ccc.Hex) => void;
  onConfirmationWait?: () => void;
  sleep?: (ms: number) => Promise<void>;
}

export class TransactionConfirmationError extends Error {
  constructor(
    message: string,
    public readonly txHash: ccc.Hex,
    public readonly status: string | undefined,
    public readonly isTimeout: boolean,
  ) {
    super(message);
    this.name = "TransactionConfirmationError";
  }
}

type IckbUdtCompleter = Pick<IckbUdt, "completeBy" | "infoFrom" | "isUdt">;

/**
 * Completes a stack-built partial transaction with the iCKB post-processing
 * steps.
 *
 * The transaction completion boundary stays the same: callers still decide when
 * to finalize, but they no longer need to duplicate the required order.
 */
export async function completeIckbTransaction(
  txLike: ccc.TransactionLike,
  ickbUdt: IckbUdtCompleter,
  options: CompleteIckbTransactionOptions,
): Promise<ccc.Transaction> {
  const tx = await ickbUdt.completeBy(txLike, options.signer);
  await tx.completeFeeBy(options.signer, options.feeRate);
  await assertDaoOutputLimit(tx, options.client);
  return tx;
}

export async function sendAndWaitForCommit(
  { client, signer }: { client: ccc.Client; signer: ccc.Signer },
  tx: ccc.Transaction,
  {
    maxConfirmationChecks = 60,
    confirmationIntervalMs = 10_000,
    onSent,
    onConfirmationWait,
    sleep = delay,
  }: SendAndWaitForCommitOptions = {},
): Promise<ccc.Hex> {
  const txHash = await signer.sendTransaction(tx);
  onSent?.(txHash);
  let status: string | undefined = "sent";

  for (let checks = 0; checks < maxConfirmationChecks && isPendingStatus(status); checks += 1) {
    try {
      status = (await client.getTransaction(txHash))?.status;
    } catch (error) {
      throw new TransactionConfirmationError(
        error instanceof Error && error.message
          ? `Transaction confirmation failed: ${error.message}`
          : "Transaction confirmation failed",
        txHash,
        status,
        true,
      );
    }
    if (!isPendingStatus(status)) {
      break;
    }

    onConfirmationWait?.();
    await sleep(confirmationIntervalMs);
  }

  if (status === "committed") {
    return txHash;
  }

  if (isPendingStatus(status)) {
    throw new TransactionConfirmationError(
      "Transaction confirmation timed out",
      txHash,
      status,
      true,
    );
  }

  throw new TransactionConfirmationError(
    `Transaction ended with status: ${status ?? "unknown"}`,
    txHash,
    status,
    false,
  );
}

function isPendingStatus(status: string | undefined): boolean {
  return (
    status === undefined ||
    status === "sent" ||
    status === "pending" ||
    status === "proposed" ||
    status === "unknown"
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * SDK for managing iCKB operations.
 *
 * This facade intentionally stops at protocol-specific transaction construction.
 * Callers still own completion before send by explicitly calling
 * `completeTransaction(...)`.
 */
export class IckbSdk {
  /**
   * Creates an instance of IckbSdk.
   *
   * @param ickbUdt - The manager for iCKB UDT completion and account balance.
   * @param ownedOwner - The manager for owned owner operations.
   * @param ickbLogic - The manager for iCKB logic operations.
   * @param order - The manager for order operations.
   * @param bots - An array of bot lock scripts.
   */
  constructor(
    private readonly ickbUdt: IckbUdtCompleter,
    private readonly ownedOwner: OwnedOwnerManager,
    private readonly ickbLogic: LogicManager,
    private readonly order: OrderManager,
    private readonly bots: ccc.Script[],
  ) {}

  /**
   * Creates an instance of IckbSdk from script dependencies.
   *
   * @param args - Parameters matching those of getConfig.
   * @returns A new instance of IckbSdk.
   */
  static from(...args: Parameters<typeof getConfig>): IckbSdk {
    return IckbSdk.fromConfig(getConfig(...args));
  }

  static fromConfig(config: ReturnType<typeof getConfig>): IckbSdk {
    const {
      managers: { ickbUdt, ownedOwner, logic, order },
      bots,
    } = config;

    return new IckbSdk(ickbUdt, ownedOwner, logic, order, bots);
  }

  async completeTransaction(
    txLike: ccc.TransactionLike,
    options: CompleteIckbTransactionOptions,
  ): Promise<ccc.Transaction> {
    return completeIckbTransaction(txLike, this.ickbUdt, options);
  }

  /**
   * Previews the conversion between CKB and UDT.
   *
   * This method calculates a conversion preview using an exchange ratio midpoint.
   * Optionally, a fee may be applied that influences the effective conversion rate,
   * scaling the converted amount by (feeBase - fee) / feeBase.
   *
   * @param isCkb2Udt - Indicates the conversion direction:
   *                    - true: Convert CKB to UDT.
   *                    - false: Convert UDT to CKB.
   * @param amounts - An object containing value components (amounts for CKB and UDT).
   * @param system - The current system state containing exchange ratio, fee rate, tip, and order-related information.
   * @param options - Optional parameters for fee and matching:
   *    - fee: The fee to apply in integer terms (defaults to 1n for 0.001% fee).
   *    - feeBase: The base used for fee scaling (defaults to 100000n).
   *
   * @returns An object with:
   *   - convertedAmount: The estimated converted amount as a FixedPoint.
   *   - ckbFee: The fee (or gain) in CKB, as a FixedPoint.
   *   - info: Additional conversion metadata.
   *   - maturity: Optional maturity information when the preview clears the
   *     minimum match and fee threshold used for interface-sized orders.
   */
  static estimate(
    isCkb2Udt: boolean,
    amounts: ValueComponents,
    system: SystemState,
    options?: {
      fee?: ccc.Num;
      feeBase?: ccc.Num;
    },
  ): {
    convertedAmount: ccc.FixedPoint;
    ckbFee: ccc.FixedPoint;
    info: Info;
    maturity: ccc.Num | undefined;
  } {
    // Apply a 0.001% default fee if none provided.
    options = {
      fee: 1n,
      feeBase: 100000n,
      ...options,
    };
    const { convertedAmount, ckbFee, info } = OrderManager.convert(
      isCkb2Udt,
      system.exchangeRatio,
      amounts,
      options,
    );

    // Only previews that clear the minimum match and fee threshold get a
    // maturity estimate. Smaller previews still return convertedAmount/info.
    const maturity =
      ckbFee >= 10n * system.feeRate
        ? IckbSdk.maturity({ info, amounts }, system)
        : undefined;

    return { convertedAmount, ckbFee, info, maturity };
  }

  /**
   * Estimates the maturity for an order formatted as a Unix timestamp.
   *
   * Depending on the order type and amount remaining, the method calculates an estimated timestamp
   * when the order (or part thereof) might be fulfilled.
   *
   * @param o - Either an OrderCell or an object containing order Info and value components.
   * @param system - The current system state.
   * @returns The Unix timestamp of estimated maturity as a bigint (in milliseconds),
   *          based on `system.tip.timestamp`, or undefined if not applicable.
   */
  static maturity(
    o:
      | OrderCell
      | {
          info: Info;
          amounts: ValueComponents;
        },
    system: SystemState,
  ): bigint | undefined {
    const info = "info" in o ? o.info : o.data.info;
    const amounts =
      "amounts" in o
        ? o.amounts
        : { ckbValue: o.ckbUnoccupied, udtValue: o.udtValue };

    // Dual-ratio orders have no fixed maturity.
    if (info.isDualRatio()) {
      return;
    }

    const isCkb2Udt = info.isCkb2Udt();
    const amount = isCkb2Udt ? amounts.ckbValue : amounts.udtValue;
    const ratio = isCkb2Udt ? info.ckbToUdt : info.udtToCkb;

    // If order is already fulfilled.
    if (amount === 0n) {
      return 0n;
    }

    const { tip, exchangeRatio, orderPool, ckbAvailable, ckbMaturing } = system;

    // Create a reference ratio instance for comparison.
    const b = new Info(ratio, ratio, 1);
    let ckb = isCkb2Udt ? amount : 0n;
    let udt = isCkb2Udt ? 0n : amount;
    for (const o of orderPool) {
      const a = o.data.info;
      if (a.isCkb2Udt()) {
        // If not isCkb2Udt or a worse ratio, add available CKB.
        if (!isCkb2Udt || a.ckb2UdtCompare(b) < 0) {
          ckb += o.ckbUnoccupied;
        }
      } else {
        // Conversely for UDT to CKB orders.
        if (isCkb2Udt || a.udt2CkbCompare(b) < 0) {
          udt += o.udtValue;
        }
      }
    }
    // Adjust ckb by the converted UDT amount.
    ckb -= convert(false, udt, exchangeRatio);

    // Minimum maturity of 10 minutes (in milliseconds).
    let maturity = 10n * 60n * 1000n;
    if (isCkb2Udt) {
      // For CKB to UDT orders, extend maturity based on the CKB amount.
      if (ckb > 0n) {
        maturity *= 1n + ckb / ccc.fixedPointFrom("200000");
      }
      return maturity + tip.timestamp;
    }

    // For UDT to CKB orders, add available CKB.
    ckb += ckbAvailable;
    if (ckb >= 0n) {
      return maturity + tip.timestamp;
    }

    // Find the earliest maturity in the ckbMaturing array that satisfies the required CKB.
    const ckbNeeded = -ckb;
    const i = binarySearch(
      ckbMaturing.length,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (n) => ckbMaturing[n]!.ckbCumulative >= ckbNeeded,
    );

    return ckbMaturing[i]?.maturity;
  }

  /**
   * Mints a new order cell and appends it to the transaction.
   *
   * The method performs the following operations:
   * - Creates order cell data using provided amounts and order information.
   * - Adds the required order cell dependencies to the transaction.
   * - Appends the order cell to the transaction outputs.
   *
   * @param txLike - The transaction to which the order cell is added.
   * @param user - The user, represented either as a Signer or a Script.
   * @param info - The order information meta data (usually computed via OrderManager.convert).
   * @param amounts - The value components for the order, including:
   *    - ckbValue: The CKB amount (may include an internal surplus).
   *    - udtValue: The UDT amount.
   *
   * @returns A Promise resolving to the updated transaction.
   *
   * @remarks The returned transaction is not finalized. Callers own the
   * completion pipeline and may use `completeTransaction(...)` before send.
   */
  async request(
    txLike: ccc.TransactionLike,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<ccc.Transaction> {
    // If the user is provided as a Signer, extract the recommended lock script.
    user =
      "codeHash" in user
        ? user
        : (await user.getRecommendedAddressObj()).script;

    return this.order.mint(txLike, user, info, amounts);
  }

  /**
   * Melts (cancels) the specified order groups.
   *
   * For each order group, if the option is set to process fulfilled orders only,
   * it filters accordingly. Then, for every valid group, the master and order cells are added
   * as inputs to the transaction.
   *
   * @param txLike - The transaction to which the inputs are added.
   * @param groups - An array of order groups to be melted.
   * @param options - Optional parameters:
   *    - isFulfilledOnly: If true, only order groups with fully or partially fulfilled orders are processed.
   *
   * @returns The updated transaction.
   *
   * @remarks The returned transaction is not finalized. Callers own the
   * completion pipeline and may use `completeTransaction(...)` before send.
   */
  collect(
    txLike: ccc.TransactionLike,
    groups: OrderGroup[],
    options?: {
      isFulfilledOnly?: boolean;
    },
  ): ccc.Transaction {
    return this.order.melt(txLike, groups, options);
  }

  /**
   * Builds the shared partial transaction from currently actionable account state.
   *
   * This keeps the order of stack-owned steps in one place: optional withdrawal
   * requests first, then collect user orders, complete ready receipts, and
   * finalize ready withdrawals.
   *
   * @param txLike - The transaction to extend.
   * @param client - The blockchain client used by withdrawal completion.
   * @param options.withdrawalRequest - Optional DAO withdrawal request to append
   * before the input-only base activity.
   * @param options.withdrawalRequest.requiredLiveDeposits - Live deposit anchors
   * that must remain resolvable while the requested deposits are spent.
   * @param options.orders - User-owned order groups to collect.
   * @param options.receipts - Receipts ready for deposit phase 2 completion.
   * @param options.readyWithdrawals - Mature withdrawal groups ready to complete.
   * @returns A Promise resolving to the updated partial transaction.
   */
  async buildBaseTransaction(
    txLike: ccc.TransactionLike,
    client: ccc.Client,
    options?: {
      withdrawalRequest?: {
        deposits: IckbDepositCell[];
        requiredLiveDeposits?: IckbDepositCell[];
        lock: ccc.Script;
      };
      orders?: OrderGroup[];
      receipts?: ReceiptCell[];
      readyWithdrawals?: WithdrawalGroup[];
    },
  ): Promise<ccc.Transaction> {
    let tx = ccc.Transaction.from(txLike);

    if (options?.withdrawalRequest?.deposits.length) {
      tx = await this.ownedOwner.requestWithdrawal(
        tx,
        options.withdrawalRequest.deposits,
        options.withdrawalRequest.lock,
        client,
      );
      for (const deposit of options.withdrawalRequest.requiredLiveDeposits ?? []) {
        tx.addCellDeps({ outPoint: deposit.cell.outPoint, depType: "code" });
      }
    }

    if (options?.orders?.length) {
      tx = this.collect(tx, options.orders);
    }

    if (options?.receipts?.length) {
      tx = this.ickbLogic.completeDeposit(tx, options.receipts);
    }

    if (options?.readyWithdrawals?.length) {
      tx = await this.ownedOwner.withdraw(tx, options.readyWithdrawals, client);
    }

    return tx;
  }

  async getAccountState(
    client: ccc.Client,
    locks: ccc.Script[],
    tip: ccc.ClientBlockHeader,
  ): Promise<AccountState> {
    const [cells, receipts, withdrawalGroups] = await Promise.all([
      this.findAccountCells(client, locks),
      collect(this.ickbLogic.findReceipts(client, locks, { onChain: true })),
      collect(
        this.ownedOwner.findWithdrawalGroups(client, locks, {
          onChain: true,
          tip,
        }),
      ),
    ]);
    const nativeUdtInfo = await this.ickbUdt.infoFrom(
      client,
      cells.filter((cell) => this.ickbUdt.isUdt(cell)),
    );

    return {
      capacityCells: cells.filter(isPlainCapacityCell),
      nativeUdtCapacity: nativeUdtInfo.capacity,
      nativeUdtBalance: nativeUdtInfo.balance,
      receipts,
      withdrawalGroups,
    };
  }

  /**
   * Retrieves the L1 state from the blockchain.
   *
   * The method performs the following:
   * - Obtains the current block tip and calculates the exchange ratio.
   * - Fetches available CKB and the maturing CKB based on bot capacities and direct deposit scans.
   * - Filters orders into user-owned and system orders based on the provided locks.
   * - Estimates user-owned orders maturity.
   *
   * @param client - The blockchain client interface.
   * @param locks - An array of lock scripts used to filter user cells.
   * @returns A promise that resolves to an object containing:
   *   - system: The system state (fee rate, tip header, exchange ratio, order pool, etc.).
   *   - user: The user's orders grouped as an array of OrderGroup.
   */
  async getL1State(
    client: ccc.Client,
    locks: ccc.Script[],
  ): Promise<{ system: SystemState; user: { orders: OrderGroup[] } }> {
    const tip = await client.getTipHeader();
    const exchangeRatio = Ratio.from(ickbExchangeRatio(tip));

    // Parallel fetching of system components.
    const [{ ckbAvailable, ckbMaturing }, orders, feeRate] = await Promise.all([
      this.getCkb(client, tip),
      collect(this.order.findOrders(client, { onChain: true })),
      client.getFeeRate(),
    ]);

    const midInfo = new Info(exchangeRatio, exchangeRatio, 1);
    const userOrders: OrderGroup[] = [];
    const systemOrders: OrderCell[] = [];
    for (const group of orders) {
      if (group.isOwner(...locks)) {
        userOrders.push(group);
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

    const system = {
      feeRate,
      tip,
      exchangeRatio,
      orderPool: systemOrders,
      ckbAvailable,
      ckbMaturing,
    };

    // Estimates user orders maturity.
    for (const { order } of userOrders) {
      order.maturity = IckbSdk.maturity(order, system);
    }

    return {
      system,
      user: {
        orders: userOrders,
      },
    };
  }

  /**
   * Retrieves available CKB and maturing CKB values from the blockchain.
   *
   * This method:
   * - Fetches bot withdrawal requests and bot plain-capacity balances.
   * - Aggregates available CKB balances from bot capacities.
   * - Calculates maturing CKB values (with their expected maturity timestamps)
   *   via direct deposit cell lookups.
   * - Sorts and cumulatively sums the maturing values for later lookup.
   *
   * @param client - The blockchain client used for fetching data.
   * @param tip - The current block tip header.
   * @returns A Promise that resolves with:
   *   - ckbAvailable: The total available CKB (as a FixedPoint).
   *   - ckbMaturing: An array of maturing CKB objects containing the cumulative CKB
   *                  and the associated maturity timestamp.
   */
  private async getCkb(
    client: ccc.Client,
    tip: ccc.ClientBlockHeader,
  ): Promise<{
    ckbAvailable: ccc.FixedPoint;
    ckbMaturing: CkbCumulative[];
  }> {
    const limit = defaultFindCellsLimit;
    const withdrawalOptions = {
      onChain: true,
      tip,
      limit,
    };
    const directDepositOptions = {
      onChain: true,
      tip,
      limit: scanLimit(limit),
    };

    // Start fetching bot iCKB withdrawal requests.
    const promiseBotWithdrawals = collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, withdrawalOptions),
    );

    // Map to track each bot's available CKB (minus a reserved amount for internal operations).
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    const reserved = -ccc.fixedPointFrom("2000");
    for (const lock of unique(this.bots)) {
      let scanned = 0;
      for await (const cell of client.findCellsOnChain(
        {
          script: lock,
          scriptType: "lock",
          filter: {
            scriptLenRange: [0n, 1n],
          },
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        scanLimit(limit),
      )) {
        scanned += 1;
        if (cell.cellOutput.type !== undefined || !cell.cellOutput.lock.eq(lock)) {
          continue;
        }

        const key = cell.cellOutput.lock.toHex();
        if (isPlainCapacityCell(cell)) {
          const ckb =
            (bot2Ckb.get(key) ?? reserved) + cell.cellOutput.capacity;
          bot2Ckb.set(key, ckb);
        }
      }
      assertCompleteScan(scanned, limit, "bot capacity", lock);
    }

    const ckbMaturing = new Array<{
      ckbValue: ccc.FixedPoint;
      maturity: ccc.Num;
    }>();
    for (const wr of await promiseBotWithdrawals) {
      if (wr.owned.isReady) {
        // Update the bot's CKB based on withdrawal if the bot is ready.
        const key = wr.owner.cell.cellOutput.lock.toHex();
        const ckb = (bot2Ckb.get(key) ?? reserved) + wr.ckbValue;
        bot2Ckb.set(key, ckb);
        continue;
      }

      // Otherwise, add to maturing amounts.
      ckbMaturing.push({
        ckbValue: wr.ckbValue,
        maturity: wr.owned.maturity.toUnix(tip),
      });
    }

    // Sum available CKB across all bot lock scripts.
    let ckbAvailable = 0n;
    for (const ckb of bot2Ckb.values()) {
      if (ckb > 0n) {
        ckbAvailable += ckb;
      }
    }

    // Bot-owned no-type data cells are not distinguishable from arbitrary payloads,
    // so the SDK currently falls back to direct deposit scanning instead of trusting
    // snapshot-like bytes from wallet-owned cells.
    let depositsScanned = 0;
    for await (const d of this.ickbLogic.findDeposits(client, directDepositOptions)) {
      depositsScanned += 1;
      if (d.isReady) {
        ckbAvailable += d.ckbValue;
        continue;
      }

      ckbMaturing.push({
        ckbValue: d.ckbValue,
        maturity: d.maturity.toUnix(tip),
      });
    }
    assertCompleteScan(depositsScanned, limit, "iCKB deposit");

    // Sort maturing CKB entries by their maturity timestamp.
    ckbMaturing.sort((a, b) => Number(a.maturity - b.maturity));

    // Calculate cumulative maturing CKB values.
    let cumulative = 0n;
    const ckbCumulativeMaturing: CkbCumulative[] = [];
    for (const { ckbValue, maturity } of ckbMaturing) {
      cumulative += ckbValue;
      ckbCumulativeMaturing.push({ ckbCumulative: cumulative, maturity });
    }

    return {
      ckbAvailable,
      ckbMaturing: ckbCumulativeMaturing,
    };
  }

  private async findAccountCells(
    client: ccc.Client,
    locks: ccc.Script[],
  ): Promise<ccc.Cell[]> {
    const cells: ccc.Cell[] = [];
    const limit = defaultFindCellsLimit;
    for (const lock of unique(locks)) {
      let scanned = 0;
      for await (const cell of client.findCellsOnChain(
        {
          script: lock,
          scriptType: "lock",
          scriptSearchMode: "exact",
          withData: true,
        },
        "asc",
        scanLimit(limit),
      )) {
        scanned += 1;
        cells.push(cell);
      }
      assertCompleteScan(scanned, limit, "account", lock);
    }
    return cells;
  }
}

function assertCompleteScan(
  scanned: number,
  limit: number,
  label: string,
  lock?: ccc.Script,
): void {
  if (scanned <= limit) {
    return;
  }

  const suffix = lock ? ` for ${lock.toHex()}` : "";
  throw new Error(`${label} scan reached limit ${String(limit)}${suffix}; state may be incomplete`);
}

function scanLimit(limit: number): number {
  return limit + 1;
}

export interface AccountState {
  capacityCells: ccc.Cell[];
  nativeUdtCapacity: bigint;
  nativeUdtBalance: bigint;
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroup[];
}

export interface AccountAvailabilityProjection {
  ckbNative: bigint;
  ickbNative: bigint;
  ckbAvailable: bigint;
  ickbAvailable: bigint;
  ckbPending: bigint;
  ickbPending: bigint;
  ckbBalance: bigint;
  ickbBalance: bigint;
  readyWithdrawals: WithdrawalGroup[];
  pendingWithdrawals: WithdrawalGroup[];
  availableOrders: OrderGroup[];
  pendingOrders: OrderGroup[];
}

export function projectAccountAvailability(
  account: AccountState,
  userOrders: OrderGroup[],
  options?: {
    /**
     * Treat matchable orders as available only when the caller will collect them
     * before spending the projected balance in the same transaction.
     */
    collectedOrdersAvailable?: boolean;
  },
): AccountAvailabilityProjection {
  const readyWithdrawals: WithdrawalGroup[] = [];
  const pendingWithdrawals: WithdrawalGroup[] = [];
  for (const group of account.withdrawalGroups) {
    if (group.owned.isReady) {
      readyWithdrawals.push(group);
    } else {
      pendingWithdrawals.push(group);
    }
  }

  const availableOrders: OrderGroup[] = [];
  const pendingOrders: OrderGroup[] = [];
  for (const group of userOrders) {
    if (
      options?.collectedOrdersAvailable ||
      group.order.isDualRatio() ||
      !group.order.isMatchable()
    ) {
      availableOrders.push(group);
    } else {
      pendingOrders.push(group);
    }
  }

  const ckbNative = sumValues(
    account.capacityCells,
    (cell) => cell.cellOutput.capacity,
  );
  const ickbNative = account.nativeUdtBalance;
  const ckbAvailable =
    ckbNative +
    sumCkb(account.receipts) +
    sumCkb(readyWithdrawals) +
    sumCkb(availableOrders);
  const ickbAvailable =
    ickbNative +
    sumUdt(account.receipts) +
    sumUdt(availableOrders);
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

function sumCkb(items: { ckbValue: bigint }[]): bigint {
  return sumValues(items, (item) => item.ckbValue);
}

function sumUdt(items: { udtValue: bigint }[]): bigint {
  return sumValues(items, (item) => item.udtValue);
}

function sumValues<T>(items: readonly T[], project: (item: T) => bigint): bigint {
  let total = 0n;
  for (const item of items) {
    total += project(item);
  }
  return total;
}

/**
 * Represents the state of the system.
 */
export interface SystemState {
  /** The fee rate for transactions. */
  feeRate: ccc.Num;

  /** The tip for the current block header. */
  tip: ccc.ClientBlockHeader;

  /** The exchange ratio between CKB and UDT. */
  exchangeRatio: Ratio;

  /** The order pool containing order cells matching system criteria. */
  orderPool: OrderCell[];

  /** The total available CKB (as FixedPoint). */
  ckbAvailable: ccc.FixedPoint;

  /** Array of CKB maturing entries with cumulative amounts and maturity timestamps. */
  ckbMaturing: CkbCumulative[];
}

/**
 * Represents a cumulative CKB maturing entry.
 */
export interface CkbCumulative {
  /** The cumulative CKB value (as FixedPoint) up to this maturity. */
  ckbCumulative: ccc.FixedPoint;
  /** The maturity timestamp (as ccc.Num). */
  maturity: ccc.Num;
}
