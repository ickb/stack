import { ccc, type Epoch } from "@ckb-ccc/core";
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
  type RatioLike,
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

  previewConversion(options: {
    isCkb2Udt: boolean;
    amount: ccc.FixedPoint;
    rate: RatioLike | ccc.ClientBlockHeader;
    fee?: {
      numerator: ccc.Num;
      denominator: ccc.Num;
    };
  }): ccc.FixedPoint {
    const { isCkb2Udt, amount, rate, fee } = options;
    let convertedAmount = convert(isCkb2Udt, amount, rate);

    if (fee) {
      const { numerator, denominator } = fee;
      convertedAmount -= (convertedAmount * numerator) / denominator;
    }

    return convertedAmount;
  }

  async convert(
    options: Parameters<IckbController["previewConversion"]>[0] & {
      ckbMinMatchLog?: number;
      signer: ccc.Signer;
      userCells: UserCells;
      system: SystemState;
      // minCkbChange?: ccc.FixedPoint; TODO
      filters: {
        isReadyOnly: boolean;
        isFulfilledOnly: boolean;
      };
    },
  ): Promise<Conversion | undefined> {
    const { isCkb2Udt, amount, rate, system, signer } = options;
    // TODO: transform into a proper type and function in ickb/Core
    const ratio =
      "udtScale" in rate
        ? {
            ckbScale: ccc.numFrom(rate.ckbScale),
            udtScale: ccc.numFrom(rate.udtScale),
          }
        : ickbExchangeRatio(rate);

    // TODO: account for fee in ratio

    const info = Info.create(isCkb2Udt, ratio, options.ckbMinMatchLog);
    const lock = (await signer.getRecommendedAddressObj()).script;
    const N = isCkb2Udt
      ? Number(amount / system.ckbDepositCap)
      : system.depositPool.slice(0, 30).length;
    const cache = Array<ReturnType<IckbController["convert"]>>(N);
    const attempt = (n: number): ReturnType<IckbController["convert"]> => {
      n = N - n;
      return (cache[n] =
        cache[n] ?? this.attemptConversion(n, info, lock, options));
    };
    return attempt(
      await asyncBinarySearch(
        N,
        async (n: number) => (await attempt(n)) !== undefined,
      ),
    );
  }

  private async attemptConversion(
    n: number,
    info: Info,
    lock: ccc.Script,
    options: Parameters<IckbController["convert"]>[0],
  ): ReturnType<IckbController["convert"]> {
    try {
      const {
        signer,
        isCkb2Udt,
        userCells,
        system: { feeRate, tip, depositPool, ckbDepositCap, exchangeRatio },
      } = options;
      let amount = options.amount;

      const tx = SmartTransaction.default();
      const maturities: Epoch[] = [];
      let ckbFee = ccc.Zero;

      // TODO: attempt to match other orders
      // TODO: add switch to turn this off
      // this.orderManager.bestMatch(tx, orderPool, exchangeRatio, {
      //   minCkbGain: 3n * feeRate,
      //   feeRate,
      // });

      // Core protocol
      // TODO: add switch to turn this off
      if (n > 0) {
        if (isCkb2Udt) {
          amount -= ckbDepositCap * BigInt(n);
          if (amount < 0n) {
            // Too many Deposits respectfully to the amount
            return undefined;
          }
          this.logicManager.deposit(tx, n, ckbDepositCap, lock);
        } else {
          const myDeposits = depositPool.slice(0, n);
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          amount -= myDeposits.slice(-1)[0]!.udtCumulative;
          if (amount < 0n) {
            // Too many Withdrawal Requests respectfully to the amount
            return undefined;
          }
          this.ownedOwnerManager.requestWithdrawal(tx, myDeposits, lock);
          maturities.push(...myDeposits.map((d) => d.maturity));
        }
      }

      // Order protocol
      // TODO: add switch to turn this off
      if (amount > 0n) {
        this.orderManager.mint(
          tx,
          lock,
          info,
          isCkb2Udt ? amount : ccc.Zero,
          isCkb2Udt ? ccc.Zero : amount,
        );

        const ratio = isCkb2Udt ? info.ckbToUdt : info.udtToCkb;
        const convertedAmount = convert(isCkb2Udt, amount, ratio);
        ckbFee = isCkb2Udt
          ? amount - convert(false, convertedAmount, exchangeRatio)
          : convert(true, amount, exchangeRatio) - convertedAmount;

        maturities.push(
          // TODO: use real world data from deposits, open orders and bot balances
          orderMaturityEstimate(isCkb2Udt, amount, tip),
        );
      }

      // Check that order provides enough fee to the bot for being matched
      // feeRate is a good approximation of the bot tx size matching the order
      if (10n * (feeRate - ckbFee) > ckbFee) {
        return undefined;
      }

      const { receipts, withdrawalGroups, orders, udts, capacities } =
        userCells;

      this.logicManager.completeDeposit(tx, receipts);
      this.ownedOwnerManager.withdraw(tx, withdrawalGroups, {
        isReadyOnly: true,
      });
      this.orderManager.melt(tx, orders);
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
  maturity: Epoch;
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
