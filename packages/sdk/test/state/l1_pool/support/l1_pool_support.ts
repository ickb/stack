import { script } from "@ickb/testkit";
import { LogicManager, OwnedOwnerManager } from "../../../../src/core/index.ts";
import { DaoManager } from "../../../../src/dao/index.ts";
import { OrderManager } from "../../../../src/order/index.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { fakeIckbUdt } from "../../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";

export const L1_STATE_SUITE = "IckbSdk.getL1State";

export function directDepositPageSizeFixture(): {
  logicManager: LogicManager;
  ownedOwnerManager: OwnedOwnerManager;
  sdk: IckbSdk;
} {
  const botLock = script("11");
  const logic = script("22");
  const dao = script("33");
  const ownedOwner = script("44");
  const order = script("55");
  const udt = script("66");
  const logicManager = new LogicManager(logic, [], new DaoManager(dao, []));
  const ownedOwnerManager = new OwnedOwnerManager(
    ownedOwner,
    [],
    new DaoManager(dao, []),
  );
  return {
    logicManager,
    ownedOwnerManager,
    sdk: new IckbSdk({
      ickbUdt: fakeIckbUdt(udt),
      ownedOwner: ownedOwnerManager,
      ickbLogic: logicManager,
      order: new OrderManager(order, [], udt),
      bots: [botLock],
    }),
  };
}
