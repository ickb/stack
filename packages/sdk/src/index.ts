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

  // TODO: Allow filtering which cells are fetched
  async getL1State(
    client: ccc.Client,
    locks: ccc.ScriptLike[],
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
    const cumulativeDepositPool: SystemState["deposits"] = [];
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
    const ckbDepositCap = convert(false, ICKB_DEPOSIT_CAP, exchangeRatio); // TODO: Remove export from core

    return {
      system: {
        feeRate,
        tip,
        exchangeRatio,
        ckbDepositCap,
        udtDepositCap: ICKB_DEPOSIT_CAP,
        deposits: cumulativeDepositPool,
        orders: nonUserOrders,
      },
      user: {
        capacities,
        udts,
        receipts,
        withdrawalGroups,
        orders: userOrders,
      },
    };
  }

  // TODO: Allow filtering which cells are accounted for
  static getBalance({
    capacities,
    udts,
    receipts,
    withdrawalGroups,
    orders,
  }: UserCells): {
    ckb: ccc.FixedPoint;
    udt: ccc.FixedPoint;
  } {
    const cells: { cell: ccc.Cell; udtValue?: ccc.FixedPoint }[] = [
      capacities,
      udts,
      receipts,
    ].flat();
    for (const { owner, owned } of withdrawalGroups) {
      cells.push(owned, owner);
    }
    for (const { master, order } of orders) {
      cells.push(master, order);
    }
    let ckb = ccc.Zero;
    let udt = ccc.Zero;
    for (const cell of cells) {
      ckb += cell.cell.cellOutput.capacity;
      udt += cell.udtValue ?? ccc.Zero;
    }
    return {
      ckb,
      udt,
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
  deposits: (IckbDepositCell & { udtCumulative: bigint })[];
  orders: OrderCell[];
}

export interface UserCells {
  capacities: CapacityCell[];
  udts: UdtCell[];
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroups[];
  orders: OrderGroup[];
}
