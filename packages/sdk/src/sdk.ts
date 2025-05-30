import { ccc } from "@ckb-ccc/core";
import {
  collect,
  CapacityManager,
  SmartTransaction,
  binarySearch,
  type ValueComponents,
  hexFrom,
  getHeader,
  Epoch,
} from "@ickb/utils";
import {
  convert,
  ICKB_DEPOSIT_CAP,
  ickbExchangeRatio,
  type LogicManager,
  type OwnedOwnerManager,
} from "@ickb/core";
import {
  Info,
  OrderManager,
  Ratio,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";
import { getConfig } from "./constants.js";
import { PoolSnapshot } from "./codec.js";

/**
 * SDK for managing iCKB operations.
 */
export class IckbSdk {
  /**
   * Creates an instance of IckbSdk.
   *
   * @param ownedOwner - The manager for owned owner operations.
   * @param ickbLogic - The manager for iCKB logic operations.
   * @param order - The manager for order operations.
   * @param capacity - The capacity manager instance.
   * @param bots - An array of bot lock scripts.
   */
  constructor(
    private readonly ownedOwner: OwnedOwnerManager,
    private readonly ickbLogic: LogicManager,
    private readonly order: OrderManager,
    private readonly capacity: CapacityManager,
    private readonly bots: ccc.Script[],
  ) {}

  /**
   * Creates an instance of IckbSdk from script dependencies.
   *
   * @param args - Parameters matching those of getConfig.
   * @returns A new instance of IckbSdk.
   */
  static from(...args: Parameters<typeof getConfig>): IckbSdk {
    const {
      managers: { ownedOwner, ickbLogic, order, capacity },
      bots,
    } = getConfig(...args);

    return new IckbSdk(ownedOwner, ickbLogic, order, capacity, bots);
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
   *   - maturity: Optional maturity information (as ccc.Num) if meets criteria.
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

    // If the fee meets a threshold, calculate the order maturity; otherwise, maturity is undefined.
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
   * @returns The Unix timestamp of estimated maturity as a bigint (in milliseconds) or undefined if not applicable.
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
      return maturity + ("info" in o ? BigInt(Date.now()) : tip.timestamp);
    }

    // For UDT to CKB orders, add available CKB.
    ckb += ckbAvailable;
    if (ckb >= 0) {
      return maturity + ("info" in o ? BigInt(Date.now()) : tip.timestamp);
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
   * - Adds required cell dependencies and UDT handlers to the transaction.
   * - Appends the order cell to the transaction outputs.
   *
   * @param tx - The smart transaction to which the order cell is added.
   * @param user - The user, represented either as a Signer or a Script.
   * @param info - The order information meta data (usually computed via OrderManager.convert).
   * @param amounts - The value components for the order, including:
   *    - ckbValue: The CKB amount (may include an internal surplus).
   *    - udtValue: The UDT amount.
   *
   * @returns A Promise resolving to void.
   */
  async request(
    tx: SmartTransaction,
    user: ccc.Signer | ccc.Script,
    info: Info,
    amounts: ValueComponents,
  ): Promise<void> {
    // If the user is provided as a Signer, extract the recommended lock script.
    user =
      "codeHash" in user
        ? user
        : (await user.getRecommendedAddressObj()).script;

    this.order.mint(tx, user, info, amounts);
  }

  /**
   * Melts (cancels) the specified order groups.
   *
   * For each order group, if the option is set to process fulfilled orders only,
   * it filters accordingly. Then, for every valid group, the master and order cells are added
   * as inputs to the transaction.
   *
   * @param tx - The smart transaction to which the inputs are added.
   * @param groups - An array of order groups to be melted.
   * @param options - Optional parameters:
   *    - isFulfilledOnly: If true, only order groups with fully or partially fulfilled orders are processed.
   *
   * @returns void
   */
  collect(
    tx: SmartTransaction,
    groups: OrderGroup[],
    options?: {
      isFulfilledOnly?: boolean;
    },
  ): void {
    this.order.melt(tx, groups, options);
  }

  /**
   * Retrieves the L1 state from the blockchain.
   *
   * The method performs the following:
   * - Obtains the current block tip and calculates the exchange ratio.
   * - Fetches available CKB and the maturing CKB based on bot capacities and deposit snapshots.
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
      collect(this.order.findOrders(client)),
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
   * - Fetches bot withdrawal requests and deposit snapshots.
   * - Aggregates available CKB balances from bot capacities.
   * - Calculates maturing CKB values (with their expected maturity timestamps)
   *   based on deposit pool snapshots or via direct deposit cell lookups.
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
    const opts = {
      onChain: true,
      tip,
    };

    // Start fetching bot iCKB withdrawal requests.
    const promiseBotWithdrawals = collect(
      this.ownedOwner.findWithdrawalGroups(client, this.bots, opts),
    );

    // Initialize deposit pool snapshot.
    let poolSnapshotHex: ccc.Hex = "0x";
    let poolSnapshotEpoch = Epoch.from([0n, 0n, 1n]);
    // Map to track each bot's available CKB (minus a reserved amount for internal operations).
    const bot2Ckb = new Map<string, ccc.FixedPoint>();
    const reserved = -ccc.fixedPointFrom("2000");
    for await (const c of this.capacity.findCapacities(
      client,
      this.bots,
      opts,
    )) {
      const key = hexFrom(c.cell.cellOutput.lock);
      const ckb = (bot2Ckb.get(key) ?? reserved) + c.ckbValue;
      bot2Ckb.set(key, ckb);

      // Find the most recent deposit pool snapshot from bot cell output data.
      const outputData = c.cell.outputData;
      if (outputData.length % 256 === 2) {
        const h = await getHeader(client, {
          type: "txHash",
          value: c.cell.outPoint.txHash,
        });
        const e = Epoch.from(h.epoch);
        if (poolSnapshotEpoch.compare(e) < 0) {
          poolSnapshotHex = outputData;
          poolSnapshotEpoch = e;
        }
      }
    }

    const ckbMaturing = new Array<{
      ckbValue: ccc.FixedPoint;
      maturity: ccc.Num;
    }>();
    for (const wr of await promiseBotWithdrawals) {
      if (wr.owned.isReady) {
        // Update the bot's CKB based on withdrawal if the bot is ready.
        const key = hexFrom(wr.owner.cell.cellOutput.lock);
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

    // Estimate available CKB from deposit pool snapshot.
    const tipEpoch = Epoch.from(tip.epoch);
    const oneCycle = Epoch.from([180n, 0n, 1n]);
    if (poolSnapshotHex !== "0x") {
      const eNumber = tip.epoch[0];
      let start = Epoch.from([eNumber - (eNumber % 180n), 0n, 1n]);
      const step = Epoch.from([0n, 180n, 1024n]);
      const depositSize = convert(false, ICKB_DEPOSIT_CAP, tip);
      for (const binAmount of PoolSnapshot.decode(poolSnapshotHex)) {
        const end = start.add(step);

        if (binAmount > 0) {
          ckbMaturing.push({
            ckbValue: BigInt(binAmount) * depositSize,
            maturity:
              tipEpoch.compare(tipEpoch) < 0
                ? // If the bin has already started, assume worst-case timing.
                  end.add(oneCycle).toUnix(tip)
                : // Otherwise, use the bin end as the maturity.
                  end.toUnix(tip),
          });
        }

        start = end;
      }
    } else {
      // Without snapshot data, fetch deposits directly.
      for await (const d of this.ickbLogic.findDeposits(client, opts)) {
        ckbMaturing.push({
          ckbValue: d.ckbValue,
          maturity: d.maturity.toUnix(tip),
        });
      }
    }

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
