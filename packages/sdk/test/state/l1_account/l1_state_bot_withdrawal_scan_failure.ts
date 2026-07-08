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
  it("propagates bot withdrawal scan failures after bot capacity scanning succeeds", async () => {
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
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(
      async function* () {
        yield* none<WithdrawalGroup>();
        await Promise.resolve();
        throw new Error(WITHDRAWAL_FAILED);
      },
    );
    const sdk = new IckbSdk(
      fakeIckbUdt(udt),
      ownedOwnerManager,
      new LogicManager(logic, [], new DaoManager(dao, [])),
      new OrderManager(order, [], udt),
      [botLock],
    );
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(headerLike(1n)),
      findCellsOnChain: emptyCellScan,
    });

    await expect(sdk.getL1State(client, [])).rejects.toThrow(WITHDRAWAL_FAILED);
  });
});
