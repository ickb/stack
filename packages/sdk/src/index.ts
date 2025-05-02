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

export class IckbController {
  constructor(
    public readonly ickbUdtManager: IckbUdtManager,
    public readonly logicManager: LogicManager,
    public readonly ownedOwnerManager: OwnedOwnerManager,
    public readonly orderManager: OrderManager,
    public readonly daoManager: DaoManager,
  ) {}

  static fromDeps({
    xudt,
    dao,
    ickbLogic,
    ownedOwner,
    order,
  }: {
    xudt: ScriptDeps;
    dao: ScriptDeps;
    ickbLogic: ScriptDeps;
    ownedOwner: ScriptDeps;
    order: ScriptDeps;
  }): IckbController {
    const daoManager = DaoManager.fromDeps(dao);

    const {
      script: { codeHash, hashType },
      cellDeps,
    } = xudt;
    const ickbXudt = {
      script: new ccc.Script(
        codeHash,
        hashType,
        [ickbLogic.script.hash(), "00000080"].join("") as ccc.Hex,
      ),
      cellDeps,
    };
    const ickbUdtManager = IckbUdtManager.fromDeps(ickbXudt, daoManager);

    return new IckbController(
      ickbUdtManager,
      LogicManager.fromDeps(ickbLogic, daoManager, ickbUdtManager),
      OwnedOwnerManager.fromDeps(ownedOwner, daoManager, ickbUdtManager),
      OrderManager.fromDeps(order, ickbUdtManager),
      daoManager,
    );
  }

  // fee examples:
  // 100000n => 0.001%
  // 10000n => 0.01%
  // 1000n => 0.1%
  // 100n => 1%
  // 10n => 10%
  // 1n => 100%
  // less than 1n => 0%
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
      const { signer, userCells, system, filters } = options;
      const { feeRate, depositPool, ckbDepositCap, exchangeRatio } = system;

      const tx = SmartTransaction.default();
      const maturities: ccc.Epoch[] = [];
      let ckbFee = ccc.Zero;
      let amount = conversion.amount;

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
          amount -= myDeposits.slice(-1)[0]!.udtCumulative;
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
          // TODO: use real world data from deposits, open orders and bot balances
          orderMaturityEstimate(isCkb2Udt, amount, system.tip),
        );
      }

      // Check that order provides enough fee to the bot for being matched
      if (ckbFee < ckbMinFee) {
        return undefined;
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

  async getL1State(
    client: ccc.Client,
    filter: Set<keyof UserCells | "depositPool">,
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
      // TODO: fetch bot cells for estimating timings
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

    return {
      system: {
        feeRate,
        tip,
        exchangeRatio,
        ckbDepositCap,
        udtDepositCap: ICKB_DEPOSIT_CAP,
        depositPool: cumulativeDepositPool,
        orderPool: nonUserOrders,
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

export interface SystemState {
  feeRate: ccc.Num;
  tip: ccc.ClientBlockHeader;
  exchangeRatio: {
    ckbScale: ccc.Num;
    udtScale: ccc.Num;
  };
  ckbDepositCap: ccc.FixedPoint;
  udtDepositCap: ccc.FixedPoint;
  depositPool: (IckbDepositCell & { udtCumulative: bigint })[];
  orderPool: OrderCell[];
}

export interface UserCells {
  capacities: CapacityCell[];
  udts: UdtCell[];
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroup[];
  orders: OrderGroup[];
  deposits: DaoCell[];
  withdrawalRequests: DaoCell[];
}

export interface Conversion {
  tx: SmartTransaction;
  ckbFee: ccc.FixedPoint;
  maturity: ccc.Epoch;
}

// Estimate bot ability to fulfill orders:
// - CKB to iCKB orders at 100k CKB every minute
// - iCKB to CKB orders at 200 CKB every minute
function orderMaturityEstimate(
  isCkb2Udt: boolean,
  amount: bigint,
  tip: ccc.ClientBlockHeader,
): ccc.Epoch {
  return epochAdd(tip.epoch, [
    0n,
    1n + amount / ccc.fixedPointFrom(isCkb2Udt ? 100000 : 200),
    4n * 60n,
  ]);
}
