import { LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { script } from "@ickb/testkit";
import { IckbSdk } from "../../../../src/sdk.ts";
import { fakeIckbUdt } from "../../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";

export const L1_STATE_SUITE = "IckbSdk.getL1State snapshot detection";

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
    sdk: new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      logicManager,
      new OrderManager(order, [], udt),
      [botLock],
    ),
  };
}
