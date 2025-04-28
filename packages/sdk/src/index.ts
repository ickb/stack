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
  ickbExchangeRatio,
  IckbManager,
  LogicManager,
  OwnedOwnerManager,
  type IckbDepositCell,
  type ReceiptCell,
  type WithdrawalGroups,
} from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager, Ratio, type OrderGroup } from "@ickb/order";

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
  ): Promise<L1State> {
    const tip = await client.getTipHeader();
    const onChain = true;
    const options = {
      tip,
      onChain,
    };
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
      arrayFrom(this.logicManager.findDeposits(client, options)),
      arrayFrom(CapacityManager.findCapacities(client, locks, options)),
      arrayFrom(this.ickbManager.findUdts(client, locks, options)),
      arrayFrom(this.logicManager.findReceipts(client, locks, options)),
      arrayFrom(this.ownedOwnerManager.findWithdrawalGroups(client, locks)),
      this.orderManager.findOrders(client),
    ]);

    depositPool.sort((a, b) => epochCompare(a.maturity, b.maturity));

    const cells: { cell: ccc.Cell; udtValue?: ccc.FixedPoint }[] = [
      capacities,
      udts,
      receipts,
    ].flat();
    for (const { owner, owned } of withdrawalGroups) {
      cells.push(owned, owner);
    }
    for (const group of orders) {
      if (!group.isOwner(...locks)) {
        continue;
      }
      const { master, order } = group;
      cells.push({ cell: master }, order); // Update master and order implementation to match interface pattern!!
    }

    const [ckbBalance, ickbBalance] = cells.reduce(
      ([ckbAcc, ickbAcc], c) => {
        return [
          ckbAcc + c.cell.cellOutput.capacity,
          c.udtValue ? ickbAcc + c.udtValue : ickbAcc,
        ];
      },
      [ccc.Zero, ccc.Zero],
    );

    return {
      ckbBalance,
      ickbBalance,
      tip,
      feeRate,
      depositPool,
      capacities,
      udts,
      receipts,
      withdrawalGroups,
      orders,
    };
  }
}

export interface L1State {
  ckbBalance: ccc.FixedPoint;
  ickbBalance: ccc.FixedPoint;
  tip: ccc.ClientBlockHeader;
  feeRate: ccc.Num;
  depositPool: IckbDepositCell[];
  capacities: CapacityCell[];
  udts: UdtCell[];
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroups[];
  orders: OrderGroup[];
}
