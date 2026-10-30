import { ccc } from "@ckb-ccc/core";
import { script, StubClient, type StubClientHandlers } from "@ickb/testkit";

import { LogicManager } from "../../../../src/logic.ts";
import { OrderManager } from "../../../../src/order/order.ts";
import { OwnedOwnerManager } from "../../../../src/owned_owner.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { fakeIckbUdt } from "../../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { headerLike } from "../../../transaction/base/support/sdk_core_support.ts";

export class FeeRateStubClient extends StubClient {
  public override async getFeeRate(): Promise<bigint> {
    await Promise.resolve();
    return 1n;
  }
}

/** Serves `anchor` as the parent of a fresh tip, the header a state read anchors at. */
export function anchoredAt(
  anchor: ccc.ClientBlockHeader,
  headers = new Map<bigint, ccc.ClientBlockHeader>(),
): Pick<StubClientHandlers, "getTipHeader" | "getHeaderByNumber"> {
  const tip = headerLike(anchor.number + 1n, {
    parentHash: anchor.hash,
    timestamp: BigInt(Date.now()),
  });
  return {
    getTipHeader: async (): ReturnType<ccc.Client["getTipHeader"]> => {
      await Promise.resolve();
      return tip;
    },
    getHeaderByNumber: async (number): ReturnType<ccc.Client["getHeaderByNumber"]> => {
      await Promise.resolve();
      const key = ccc.numFrom(number);
      return key === anchor.number ? anchor : headers.get(key);
    },
  };
}

export function defaultL1Sdk(): IckbSdk {
  const dao = script("33");
  const logic = script("22");
  const ownedOwner = script("44");
  const order = script("55");
  const udt = script("66");
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(udt),
    ownedOwner: new OwnedOwnerManager(ownedOwner, [], { script: dao, cellDeps: [] }),
    ickbLogic: new LogicManager(logic, [], { script: dao, cellDeps: [] }),
    order: new OrderManager(order, [], udt),
  });
}

export function l1SdkWithManagers(options: {
  logicManager?: LogicManager;
  ownedOwnerManager?: OwnedOwnerManager;
  orderManager?: OrderManager;
  udt?: ccc.Script;
}): IckbSdk {
  const dao = script("33");
  const udt = options.udt ?? script("66");
  const ownedOwnerManager =
    options.ownedOwnerManager ??
    new OwnedOwnerManager(script("44"), [], { script: dao, cellDeps: [] });
  const logicManager =
    options.logicManager ??
    new LogicManager(script("22"), [], { script: dao, cellDeps: [] });
  const orderManager = options.orderManager ?? new OrderManager(script("55"), [], udt);
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(udt),
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
    order: orderManager,
  });
}
