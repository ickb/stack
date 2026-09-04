import type { ccc } from "@ckb-ccc/core";
import { LogicManager, OwnedOwnerManager, type WithdrawalGroup } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { OrderManager } from "@ickb/order";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IckbSdk } from "../../../src/sdk.ts";
import { fakeIckbUdt } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  L1_STATE_SUITE,
  none,
  tipHeaderHandler,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const WITHDRAWAL_FAILED = "withdrawal failed";

describe(L1_STATE_SUITE, () => {
  it("starts bot scans concurrently and propagates withdrawal failures", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const order = script("55");
    const udt = script("66");
    const ownedOwnerManager = new OwnedOwnerManager(
      ownedOwner,
      [],
      new DaoManager(dao, []),
    );
    const capacityGate = Promise.withResolvers<undefined>();
    const withdrawalGate = Promise.withResolvers<undefined>();
    const started = new Set<string>();
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(
      async function* () {
        started.add("withdrawal");
        await withdrawalGate.promise;
        yield* none<WithdrawalGroup>();
        throw new Error(WITHDRAWAL_FAILED);
      },
    );
    const sdk = new IckbSdk({
      ickbUdt: fakeIckbUdt(udt),
      ownedOwner: ownedOwnerManager,
      ickbLogic: new LogicManager(logic, [], new DaoManager(dao, [])),
      order: new OrderManager(order, [], udt),
      bots: [botLock],
    });
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(headerLike(1n)),
      async *findCellsOnChain(query): ReturnType<ccc.Client["findCellsOnChain"]> {
        if (
          query.filter?.scriptLenRange !== undefined &&
          query.filter.outputDataLenRange !== undefined
        ) {
          started.add("capacity");
          await capacityGate.promise;
        }
        yield* emptyCellScan();
      },
    });

    const state = sdk.getL1State(client, []);
    await vi.waitFor(() => {
      expect(started).toEqual(new Set(["capacity", "withdrawal"]));
    });
    capacityGate.resolve(undefined);
    withdrawalGate.resolve(undefined);
    await expect(state).rejects.toThrow(WITHDRAWAL_FAILED);
  });
});
