import { ccc } from "@ckb-ccc/core";
import { arrayFrom, epochCompare, type ScriptDeps } from "@ickb/utils";
import {
  ickbExchangeRatio,
  iCKBUdtHandler,
  LogicManager,
  OwnedOwnerManager,
  type iCKBDepositCell,
  type ReceiptCell,
  type WithdrawalGroups,
} from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager, Ratio, type OrderGroup } from "@ickb/order";

export class IckbController {
  constructor(
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
    const udtHandler = iCKBUdtHandler.fromDeps(ickbXudt, daoManager);

    return new IckbController(
      LogicManager.fromDeps(ickbLogic, daoManager, udtHandler),
      OwnedOwnerManager.fromDeps(ownedOwner, daoManager, udtHandler),
      OrderManager.fromDeps(order, udtHandler),
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

  async fetchL1State(
    client: ccc.Client,
    locks: ccc.ScriptLike[],
  ): Promise<L1State> {
    const tip = await client.getTipHeader();
    const onChain = true;
    const options = {
      tip,
      onChain,
    };

    const [depositPool, receipts, withdrawalGroups, orders] = await Promise.all(
      [
        arrayFrom(this.logicManager.findDeposits(client, options)),
        arrayFrom(this.logicManager.findReceipts(client, locks, options)),
        arrayFrom(
          this.ownedOwnerManager.findWithdrawalGroups(client, locks, options),
        ),
        this.orderManager.findOrders(client),
      ],
    );

    depositPool.sort((a, b) => epochCompare(a.maturity, b.maturity));
    withdrawalGroups.sort((a, b) =>
      epochCompare(a.owned.maturity, b.owned.maturity),
    );

    return { tip, depositPool, receipts, withdrawalGroups, orders };
  }
}

export interface L1State {
  tip: ccc.ClientBlockHeader;
  depositPool: iCKBDepositCell[];
  receipts: ReceiptCell[];
  withdrawalGroups: WithdrawalGroups[];
  orders: OrderGroup[];
}
