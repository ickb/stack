import type { ccc } from "@ckb-ccc/core";
import { pagedCells, script, StubClient } from "@ickb/testkit";

import { LogicManager } from "../../../../src/logic.ts";
import { OrderManager } from "../../../../src/order/order.ts";
import { OwnedOwnerManager } from "../../../../src/owned_owner.ts";
import { IckbSdk } from "../../../../src/sdk.ts";
import { fakeIckbUdt } from "../../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";

export { transactionWithHeader } from "@ickb/testkit";
export { L1_STATE_SUITE } from "../../../transaction/complete/support/sdk_suite_titles.ts";

export class FeeRateStubClient extends StubClient {
  private readonly feeRate: bigint;

  constructor(handlers: ConstructorParameters<typeof StubClient>[0] = {}, feeRate = 1n) {
    super(handlers);
    this.feeRate = feeRate;
  }

  public override async getFeeRate(): Promise<bigint> {
    await Promise.resolve();
    return this.feeRate;
  }
}

export function tipHeaderHandler(
  header: ccc.ClientBlockHeader,
): ccc.Client["getTipHeader"] {
  return async (): ReturnType<ccc.Client["getTipHeader"]> => {
    await Promise.resolve();
    return header;
  };
}

export const emptyCellScan = pagedCells([]);

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
