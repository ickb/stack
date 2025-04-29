import { ccc } from "@ckb-ccc/core";
import {
  arrayFrom,
  epochCompare,
  CapacityManager,
  type ScriptDeps,
  type UdtCell,
  type CapacityCell,
} from "@ickb/utils";
import {
  convert,
  ICKB_DEPOSIT_CAP,
  ickbExchangeRatio,
  IckbManager,
  LogicManager,
  OwnedOwnerManager,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroups,
} from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import {
  OrderManager,
  Ratio,
  type OrderCell,
  type OrderGroup,
} from "@ickb/order";

export class IckbController {
  constructor(
    public ickbManager: IckbManager,
    public logicManager: LogicManager,
    public ownedOwnerManager: OwnedOwnerManager,
    public orderManager: OrderManager,
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
    const ickbManager = IckbManager.fromDeps(ickbXudt, daoManager);

    return new IckbController(
      ickbManager,
      LogicManager.fromDeps(ickbLogic, daoManager, ickbManager),
      OwnedOwnerManager.fromDeps(ownedOwner, daoManager, ickbManager),
      OrderManager.fromDeps(order, ickbManager),
    );
  }

  previewConversion(
    isCkb2Udt: boolean,
    amount: ccc.FixedPoint,
    options: ({ ratio: Ratio } | { tip: ccc.ClientBlockHeader }) & {
      fee?: {
        numerator: ccc.Num;
        denominator: ccc.Num;
      };
    },
  ): ccc.FixedPoint {
    const { ckbScale, udtScale } =
      "ratio" in options ? options.ratio : ickbExchangeRatio(options.tip);

    let convertedAmount = isCkb2Udt
      ? (amount * ckbScale) / udtScale
      : (amount * udtScale) / ckbScale;

    if (options.fee) {
      const { numerator, denominator } = options.fee;
      convertedAmount -= (convertedAmount * numerator) / denominator;
    }

    return convertedAmount;
  }

  async getL1State(
    client: ccc.Client,
    locks: ccc.ScriptLike[],
    options?: {
      minLockUp?: ccc.Epoch;
      maxLockUp?: ccc.Epoch;
    },
  ): Promise<L1State> {
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
    ] = await Promise.all([
      client.getFeeRate(),
      arrayFrom(this.logicManager.findDeposits(client, opts)),
      arrayFrom(CapacityManager.findCapacities(client, locks, opts)),
      arrayFrom(this.ickbManager.findUdts(client, locks, opts)),
      arrayFrom(this.logicManager.findReceipts(client, locks, opts)),
      arrayFrom(
        this.ownedOwnerManager.findWithdrawalGroups(client, locks, opts),
      ),
      this.orderManager.findOrders(client),
    ]);

    // Sort depositPool by maturity (oversized deposits are at the end)
    depositPool.sort((a, b) => epochCompare(a.maturity, b.maturity));
    // Calculate cumulative value of deposits in the pool
    let udtCumulative = 0n;
    const cumulativeDepositPool: L1State["systemCells"]["depositPool"] = [];
    for (const deposit of depositPool) {
      udtCumulative += deposit.udtValue;
      cumulativeDepositPool.push({ ...deposit, udtCumulative });
    }

    const cells: { cell: ccc.Cell; udtValue?: ccc.FixedPoint }[] = [
      capacities,
      udts,
      receipts,
    ].flat();
    for (const { owner, owned } of withdrawalGroups) {
      cells.push(owned, owner);
    }

    const userOrders: L1State["userCells"]["orders"] = [];
    const systemOrders: L1State["systemCells"]["orders"] = [];
    for (const group of orders) {
      const { master, order } = group;
      if (group.isOwner(...locks)) {
        userOrders.push(group);
        cells.push(master, order);
      } else {
        systemOrders.push(order);
      }
    }

    const [ckbBalance, udtBalance] = cells.reduce(
      ([ckbAcc, udtAcc], c) => {
        return [
          ckbAcc + c.cell.cellOutput.capacity,
          c.udtValue ? udtAcc + c.udtValue : udtAcc,
        ];
      },
      [ccc.Zero, ccc.Zero],
    );

    const exchangeRatio = ickbExchangeRatio(tip);
    const ckbDepositCap = convert(false, ICKB_DEPOSIT_CAP, exchangeRatio); // Remove export from core

    return {
      info: {
        feeRate,
        tip,
        exchangeRatio,
        ckbDepositCap,
        udtDepositCap: ICKB_DEPOSIT_CAP,
      },
      balance: {
        ckb: ckbBalance,
        udt: udtBalance,
      },
      userCells: {
        capacities,
        udts,
        receipts,
        withdrawalGroups,
        orders: userOrders,
      },
      systemCells: {
        depositPool: cumulativeDepositPool,
        orders: systemOrders,
      },
    };
  }
}

export interface L1State {
  info: {
    feeRate: ccc.Num;
    tip: ccc.ClientBlockHeader;
    exchangeRatio: {
      ckbScale: ccc.Num;
      udtScale: ccc.Num;
    };
    ckbDepositCap: ccc.FixedPoint;
    udtDepositCap: ccc.FixedPoint;
  };
  balance: {
    ckb: ccc.FixedPoint;
    udt: ccc.FixedPoint;
  };
  userCells: {
    capacities: CapacityCell[];
    udts: UdtCell[];
    receipts: ReceiptCell[];
    withdrawalGroups: WithdrawalGroups[];
    orders: OrderGroup[];
  };
  systemCells: {
    depositPool: (IckbDepositCell & { udtCumulative: bigint })[];
    orders: OrderCell[];
  };
}
