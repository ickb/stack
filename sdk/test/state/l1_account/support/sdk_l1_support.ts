import type { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { LogicManager, OwnedOwnerManager } from "../../../../src/core/index.ts";
import { DaoManager } from "../../../../src/dao/index.ts";
import { OrderManager } from "../../../../src/order/index.ts";
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

export function emptyCellScan(): ReturnType<ccc.Client["findCellsOnChain"]> {
  return none<ccc.Cell>();
}

export async function* none<T>(): AsyncGenerator<T> {
  const values: T[] = [];
  yield* values;
  await Promise.resolve();
}

export async function* repeat<T>(count: number, value: T): AsyncGenerator<T> {
  for (let index = 0; index < count; index += 1) {
    yield value;
  }
  await Promise.resolve();
}

export function defaultL1Sdk(): IckbSdk {
  const dao = script("33");
  const logic = script("22");
  const ownedOwner = script("44");
  const order = script("55");
  const udt = script("66");
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(udt),
    ownedOwner: new OwnedOwnerManager(ownedOwner, [], new DaoManager(dao, [])),
    ickbLogic: new LogicManager(logic, [], new DaoManager(dao, [])),
    order: new OrderManager(order, [], udt),
    bots: [],
  });
}

export function l1SdkWithManagers(options: {
  botLock?: ccc.Script;
  logicManager?: LogicManager;
  ownedOwnerManager?: OwnedOwnerManager;
  orderManager?: OrderManager;
  udt?: ccc.Script;
}): IckbSdk {
  const dao = script("33");
  const udt = options.udt ?? script("66");
  const ownedOwnerManager =
    options.ownedOwnerManager ??
    new OwnedOwnerManager(script("44"), [], new DaoManager(dao, []));
  const logicManager =
    options.logicManager ?? new LogicManager(script("22"), [], new DaoManager(dao, []));
  const orderManager = options.orderManager ?? new OrderManager(script("55"), [], udt);
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(udt),
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
    order: orderManager,
    bots: options.botLock === undefined ? [] : [options.botLock],
  });
}
