import { ccc } from "@ckb-ccc/core";
import { script, StubClient, type StubClientHandlers } from "@ickb/testkit";

import { LogicManager } from "../../../../src/logic.ts";
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
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(),
    ownedOwner: new OwnedOwnerManager(ownedOwner, [], { script: dao, cellDeps: [] }),
    ickbLogic: new LogicManager(logic, [], { script: dao, cellDeps: [] }),
  });
}

export function l1SdkWithManagers(options: {
  logicManager?: LogicManager;
  ownedOwnerManager?: OwnedOwnerManager;
}): IckbSdk {
  const dao = script("33");
  const ownedOwnerManager =
    options.ownedOwnerManager ??
    new OwnedOwnerManager(script("44"), [], { script: dao, cellDeps: [] });
  const logicManager =
    options.logicManager ??
    new LogicManager(script("22"), [], { script: dao, cellDeps: [] });
  return new IckbSdk({
    ickbUdt: fakeIckbUdt(),
    ownedOwner: ownedOwnerManager,
    ickbLogic: logicManager,
  });
}
