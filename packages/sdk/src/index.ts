import { ccc } from "@ckb-ccc/core";
import {
  collect,
  epochCompare,
  CapacityManager,
  SmartTransaction,
  type ScriptDeps,
  type UdtCell,
  type CapacityCell,
  epochAdd,
  asyncBinarySearch,
  RestrictedTransaction,
  type ExchangeRatio,
  binarySearch,
} from "@ickb/utils";
import {
  convert,
  ICKB_DEPOSIT_CAP,
  ickbExchangeRatio,
  IckbUdtManager,
  LogicManager,
  OwnedOwnerManager,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroup,
} from "@ickb/core";
import { DaoManager, type DaoCell } from "@ickb/dao";
import {
  Info,
  OrderManager,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";

/**
 * Controller for managing iCKB operations.
 */
export class IckbController {
  /**
   * Creates an instance of IckbController.
   * @param ickbUdtManager - The manager for iCKB UDT operations.
   * @param logicManager - The logic manager for handling business logic.
   * @param ownedOwnerManager - The manager for owned owner operations.
   * @param orderManager - The manager for order operations.
   * @param daoManager - The manager for DAO operations.
   */
  constructor(
    public readonly ickbUdtManager: IckbUdtManager,
    public readonly logicManager: LogicManager,
    public readonly ownedOwnerManager: OwnedOwnerManager,
    public readonly orderManager: OrderManager,
    public readonly daoManager: DaoManager,
    public readonly bots: ccc.Script[],
  ) {}

  /**
   * Creates an instance of IckbController from script dependencies.
   * @param deps - The script dependencies.
   * @param deps.udt - The script dependencies for UDT.
   * @param deps.dao - The script dependencies for DAO.
   * @param deps.ickbLogic - The script dependencies for iCKB logic.
   * @param deps.ownedOwner - The script dependencies for owned owner.
   * @param deps.order - The script dependencies for order.
   * @returns An instance of IckbController.
   */
  static fromDeps(
    deps: {
      udt: ScriptDeps;
      dao: ScriptDeps;
      ickbLogic: ScriptDeps;
      ownedOwner: ScriptDeps;
      order: ScriptDeps;
    },
    bots: ccc.Script[],
  ): IckbController {
    const daoManager = DaoManager.fromDeps(deps);
    const ickbUdtManager = IckbUdtManager.fromDeps(deps, daoManager);
    return new IckbController(
      ickbUdtManager,
      LogicManager.fromDeps(deps, daoManager, ickbUdtManager),
      OwnedOwnerManager.fromDeps(deps, daoManager, ickbUdtManager),
      OrderManager.fromDeps(deps, ickbUdtManager),
      daoManager,
      bots,
    );
  }

  /**
   * Previews the conversion between CKB and UDT.
   * @param conversion - The conversion parameters.
   * @param conversion.isCkb2Udt - Indicates if the conversion is from CKB to UDT.
   * @param conversion.amount - The amount to convert.
   * @param conversion.rate - The exchange rate for conversion.
   * @param conversion.fee - The fee for the conversion.
   * @returns The rate and converted amount.
   *
   * Fee meaning examples:
   * - 100000n => 0.001%
   * - 10000n => 0.01%
   * - 1000n => 0.1%
   * - 100n => 1%
   * - 10n => 10%
   * - 1n => 100%
   * - less than 1n => 0%
   */
  static previewConversion(conversion: {
    isCkb2Udt: boolean;
    amount: ccc.FixedPoint;
    rate: ExchangeRatio | ccc.ClientBlockHeader;
    fee: ccc.Num;
  }): { rate: ExchangeRatio; convertedAmount: ccc.FixedPoint } {
    const { isCkb2Udt, amount, fee } = conversion;
    let rate = conversion.rate;
    rate = "dao" in rate ? ickbExchangeRatio(rate) : rate;

    if (fee > ccc.Zero) {
      const { ckbScale, udtScale } = rate;
      rate = {
        ckbScale,
        // Worst case scenario where fee applies to the full amount
        udtScale: udtScale + (isCkb2Udt ? 1n : -1n) * (udtScale / fee),
      };
    }

    const convertedAmount =
      amount > ccc.Zero ? convert(isCkb2Udt, amount, rate) : ccc.Zero;

    return { rate, convertedAmount };
  }

  /**
   * Converts between CKB and UDT based on the provided options.
   * @param options - The conversion options.
   * @param options.conversion - The conversion parameters.
   * @param options.conversion.isCkb2Udt - Indicates if the conversion is from CKB to UDT.
   * @param options.conversion.amount - The amount to convert.
   * @param options.conversion.rate - The exchange rate for conversion.
   * @param options.conversion.ckbMinMatchLog - Minimum CKB match log (optional).
   * @param options.conversion.ckbMinFee - Minimum CKB fee (optional).
   * @param options.signer - The signer for the transaction.
   * @param options.userCells - The user's cells.
   * @param options.system - The current system state.
   * @param options.filters - The filters for the conversion.
   * @param options.filters.isReadyOnly - Indicates if only ready conversions should be considered.
   * @param options.filters.isFulfilledOnly - Indicates if only fulfilled conversions should be considered.
   * @returns A promise that resolves to the conversion result or undefined.
   */
  async convert(options: {
    conversion: Parameters<typeof IckbController.previewConversion>[0] & {
      ckbMinMatchLog?: number;
      ckbMinFee?: ccc.Num;
    };
    signer: ccc.Signer;
    userCells: UserCells;
    system: SystemState;
    filters: {
      isReadyOnly: boolean;
      isFulfilledOnly: boolean;
    };
  }): Promise<Conversion | undefined> {
    // Get user lock
    const { system, signer } = options;
    const lock = (await signer.getRecommendedAddressObj()).script;

    // Normalize rate
    const { rate } = IckbController.previewConversion({
      ...options.conversion,
      amount: ccc.Zero,
    });
    const { isCkb2Udt, amount, ckbMinMatchLog } = options.conversion;
    const info = Info.create(isCkb2Udt, rate, ckbMinMatchLog);
    // feeRate is a good approximation of the bot tx size matching the order
    const ckbMinFee = options.conversion.ckbMinFee ?? 10n * system.feeRate;
    const conversion = {
      isCkb2Udt,
      amount,
      rate,
      info,
      ckbMinFee,
      lock,
    };

    const N = isCkb2Udt
      ? Number(amount / system.ckbDepositCap)
      : system.depositPool.slice(0, 30).length;

    const cache = Array<ReturnType<IckbController["convert"]>>(N);
    const cachedAttempt = (
      n: number,
    ): ReturnType<IckbController["convert"]> => {
      n = N - n;
      return (cache[n] = cache[n] ?? this.attempt(n, conversion, options));
    };

    return cachedAttempt(
      await asyncBinarySearch(
        N,
        async (n: number) => (await cachedAttempt(n)) !== undefined,
      ),
    );
  }

  /**
   * Attempts to perform a conversion based on the provided parameters.
   * @param n - The size of deposit to make or withdraw from.
   * @param conversion - The conversion parameters.
   * @param conversion.isCkb2Udt - Indicates if the conversion is from CKB to UDT.
   * @param conversion.amount - The amount to convert.
   * @param conversion.rate - The exchange rate for conversion.
   * @param conversion.info - Additional information for the conversion.
   * @param conversion.ckbMinFee - Minimum CKB fee.
   * @param conversion.lock - The script lock for the transaction.
   * @param options - Additional options for the conversion.
   * @returns A promise that resolves to the conversion result or undefined.
   */
  private async attempt(
    n: number,
    conversion: {
      isCkb2Udt: boolean;
      amount: bigint;
      rate: ExchangeRatio;
      info: Info;
      ckbMinFee: ccc.Num;
      lock: ccc.Script;
    },
    options: Omit<Parameters<IckbController["convert"]>[0], "conversion">,
  ): ReturnType<IckbController["convert"]> {
    try {
      const { isCkb2Udt, rate, info, ckbMinFee, lock } = conversion;
      const { signer, userCells, filters, system } = options;
      const { feeRate, ckbDepositCap, exchangeRatio, depositPool } = system;

      const tx = SmartTransaction.default();
      const maturities: ccc.Epoch[] = [[0n, 1n, 80n]]; // 3 minutes minimum
      let ckbFee = ccc.Zero;
      let amount = conversion.amount;
      let udtWithdrawed = ccc.Zero;

      // Core protocol
      if (n > 0) {
        if (isCkb2Udt) {
          amount -= ckbDepositCap * BigInt(n);
          if (amount < ccc.Zero) {
            // Too many Deposits respectfully to the amount
            return undefined;
          }
          this.logicManager.deposit(tx, n, ckbDepositCap, lock);
        } else {
          const myDeposits = depositPool.slice(0, n);
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          udtWithdrawed = myDeposits.slice(-1)[0]!.udtCumulative;
          amount -= udtWithdrawed;
          if (amount < ccc.Zero) {
            // Too many Withdrawal Requests respectfully to the amount
            return undefined;
          }
          this.ownedOwnerManager.requestWithdrawal(tx, myDeposits, lock);
          maturities.push(...myDeposits.map((d) => d.maturity));
        }
      }

      // Order protocol
      if (amount > ccc.Zero) {
        this.orderManager.mint(tx, lock, info, {
          ckbValue: isCkb2Udt ? amount : ccc.Zero,
          udtValue: isCkb2Udt ? ccc.Zero : amount,
        });

        const convertedAmount = convert(isCkb2Udt, amount, rate);
        ckbFee = isCkb2Udt
          ? amount - convert(false, convertedAmount, exchangeRatio)
          : convert(true, amount, exchangeRatio) - convertedAmount;

        maturities.push(
          orderMaturityEstimate(isCkb2Udt, amount, udtWithdrawed, system),
        );

        // Check that order provides enough fee to the bot for being matched
        if (ckbFee < ckbMinFee) {
          return undefined;
        }
      }

      const { receipts, withdrawalGroups, orders, udts, capacities } =
        userCells;

      this.logicManager.completeDeposit(tx, receipts);
      this.ownedOwnerManager.withdraw(tx, withdrawalGroups, filters);
      this.orderManager.melt(tx, orders, filters);
      this.ickbUdtManager.addUdts(tx, udts);
      CapacityManager.addCapacities(tx, capacities);

      // Throw an error if inputs do not cover for outputs
      await new RestrictedTransaction(tx).completeFeeBy(signer, feeRate);

      // Find the maturity most distant in the future
      const maturity = maturities.reduce((a, b) =>
        epochCompare(a, b) === -1 ? b : a,
      );

      return {
        tx,
        ckbFee,
        maturity,
      };

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_) {
      return undefined;
    }
  }

  /**
   * Retrieves the L1 state based on the provided parameters.
   * @param client - The client to interact with the blockchain.
   * @param filter - The set of filters to apply.
   * @param locks - The script locks to filter the user cells.
   * @param options - Optional parameters for the state retrieval.
   * @param options.minLockUp - The minimum lock-up period (optional).
   * @param options.maxLockUp - The maximum lock-up period (optional).
   * @returns A promise that resolves to an object containing the system state and user cells.
   */
  async getL1State(
    client: ccc.Client,
    filter: Set<keyof UserCells | "depositPool" | "ckbBots">,
    locks: ccc.Script[],
    options?: {
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): Promise<{
    system: SystemState;
    user: UserCells;
  }> {
    const tip = await client.getTipHeader();
    const onChain = true;
    const opts = { ...options, tip, onChain };
    const [
      feeRate,
      depositPool,
      capacities,
      udts,
      receipts,
      withdrawalGroups,
      orders,
      deposits,
      withdrawalRequests,
      botCapacities,
    ] = await Promise.all([
      client.getFeeRate(),
      filter.has("depositPool")
        ? collect(this.logicManager.findDeposits(client, opts))
        : [],
      filter.has("capacities")
        ? collect(CapacityManager.findCapacities(client, locks, opts))
        : [],
      filter.has("udts")
        ? collect(this.ickbUdtManager.findUdts(client, locks, opts))
        : [],
      filter.has("receipts")
        ? collect(this.logicManager.findReceipts(client, locks, opts))
        : [],
      filter.has("withdrawalGroups")
        ? collect(
            this.ownedOwnerManager.findWithdrawalGroups(client, locks, opts),
          )
        : [],
      filter.has("orders") ? collect(this.orderManager.findOrders(client)) : [],
      filter.has("deposits")
        ? collect(this.daoManager.findDeposits(client, locks, opts))
        : [],
      filter.has("withdrawalRequests")
        ? collect(this.daoManager.findWithdrawalRequests(client, locks, opts))
        : [],
      filter.has("ckbBots")
        ? collect(CapacityManager.findCapacities(client, locks, opts))
        : [],
    ]);

    // Sort depositPool by maturity
    depositPool.sort((a, b) => epochCompare(a.maturity, b.maturity));
    // Calculate cumulative value of deposits in the pool
    let udtCumulative = 0n;
    const cumulativeDepositPool: SystemState["depositPool"] = [];
    for (const deposit of depositPool) {
      udtCumulative += deposit.udtValue;
      cumulativeDepositPool.push({ ...deposit, udtCumulative });
    }

    const userOrders: OrderGroup[] = [];
    const nonUserOrders: OrderCell[] = [];
    for (const group of orders) {
      if (group.isOwner(...locks)) {
        userOrders.push(group);
      } else {
        nonUserOrders.push(group.order);
      }
    }

    const exchangeRatio = ickbExchangeRatio(tip);
    const ckbDepositCap = convert(false, ICKB_DEPOSIT_CAP, exchangeRatio);

    // Calculate the ckb ready to match incoming transactions
    let ckbBots = botCapacities.reduce((acc, c) => acc + c.ckbValue, ccc.Zero);
    // Each bot keeps a reserve of CKB for operations
    ckbBots -= ccc.numFrom(this.bots.length) * ccc.fixedPointFrom("2000");
    ckbBots = ckbBots > ccc.Zero ? ckbBots : ccc.Zero;

    return {
      system: {
        feeRate,
        tip,
        exchangeRatio,
        ckbDepositCap,
        udtDepositCap: ICKB_DEPOSIT_CAP,
        depositPool: cumulativeDepositPool,
        orderPool: nonUserOrders,
        ckbBots,
      },
      user: {
        capacities,
        udts,
        receipts,
        withdrawalGroups,
        orders: userOrders,
        deposits,
        withdrawalRequests,
      },
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
  exchangeRatio: ExchangeRatio;

  /** The deposit cap expressed in CKB. */
  ckbDepositCap: ccc.FixedPoint;

  /** The deposit cap expressed in iCKB. */
  udtDepositCap: ccc.FixedPoint;

  /**
   * The deposit pool containing iCKB deposit cells with cumulative iCKB amounts.
   */
  depositPool: (IckbDepositCell & { udtCumulative: bigint })[];

  /**
   * The order pool containing non-user order cells.
   */
  orderPool: OrderCell[];

  /**
   * The ckb held by bots ready to match incoming iCKB to CKB conversions.
   */
  ckbBots: ccc.FixedPoint;
}

/**
 * Represents the user cells in the system.
 */
export interface UserCells {
  /** The capacities owned by the user. */
  capacities: CapacityCell[];

  /** The UDTs owned by the user. */
  udts: UdtCell[];

  /** The receipts associated with the user's transactions. */
  receipts: ReceiptCell[];

  /** The withdrawal groups for the user. */
  withdrawalGroups: WithdrawalGroup[];

  /** The orders placed by the user. */
  orders: OrderGroup[];

  /** The classical/non-iCKB deposits made by the user. */
  deposits: DaoCell[];

  /** The classical/non-iCKB withdrawal requests made by the user. */
  withdrawalRequests: DaoCell[];
}

/**
 * Represents a conversion transaction.
 */
export interface Conversion {
  /** The smart transaction associated with the conversion. */
  tx: SmartTransaction;

  /** The fee in CKB for the order created by the conversion. */
  ckbFee: ccc.FixedPoint;

  /** The estimated maturity epoch for conversion. */
  maturity: ccc.Epoch;
}

/**
 * Estimates the maturity of an order based on the type of conversion and amount.
 *
 * @param isCkb2Udt - A boolean indicating if the order is from CKB to UDT.
 * @param amount - The amount of CKB or UDT involved in the order.
 * @param udtWithdrawed - The amount of UDT that has been withdrawn by the current conversion via core.
 * @param system - The current system state, which includes the block header tip, order pool, deposit pool, CKB bots, and exchange ratio.
 *
 * @returns The estimated maturity epoch for the order.
 */
function orderMaturityEstimate(
  isCkb2Udt: boolean,
  amount: bigint,
  udtWithdrawed: ccc.FixedPoint,
  system: SystemState,
): ccc.Epoch {
  const { tip, orderPool, depositPool, ckbBots, exchangeRatio } = system;

  // Maturity estimate a priori, the estimation is based on:
  // - CKB to iCKB orders at 100k CKB every minute
  // - iCKB to CKB orders at 200 CKB every minute
  let maturity = epochAdd(tip.epoch, [
    0n,
    1n + amount / ccc.fixedPointFrom(isCkb2Udt ? 100000 : 200),
    4n * 60n,
  ]);

  if (isCkb2Udt) {
    return maturity;
  }

  if (depositPool.length > 0) {
    const udtWaiting = orderPool
      .filter((o) => o.isUdt2CkbMatchable())
      .reduce((acc, o) => acc + o.udtValue, ccc.Zero);
    const udtAvailable = convert(isCkb2Udt, ckbBots, exchangeRatio);

    const udtToConvert = amount + udtWithdrawed + udtWaiting - udtAvailable;
    const i = binarySearch(
      depositPool.length,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      (n) => depositPool[n]!.udtCumulative >= udtToConvert,
    );

    maturity = depositPool[i]?.maturity ?? maturity;
  }

  return maturity;
}
