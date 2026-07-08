import { ccc } from "@ckb-ccc/core";
import { LogicManager, OwnedOwnerManager } from "@ickb/core";
import { DaoManager } from "@ickb/dao";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  l1SdkWithManagers,
  none,
  repeat,
  tipHeaderHandler,
  transactionWithHeader,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("treats ready deposits as available CKB instead of future maturity", async () => {
    const botLock = script("11");
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const daoManager = new DaoManager(dao, []);
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const readyDeposit = depositCell("03", logic, dao, headerLike(0n), headerLike(0n), {
      isReady: true,
    });
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockImplementation(() => repeat(1, readyDeposit));
    vi.spyOn(ownedOwnerManager, "findWithdrawalGroups").mockImplementation(() => none());
    const sdk = l1SdkWithManagers({
      botLock,
      ownedOwnerManager,
      logicManager,
    });
    const tip = headerLike(1n, { epoch: ccc.Epoch.from([181n, 0n, 1n]) });
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(tip),
      findCellsOnChain: emptyCellScan,
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return transactionWithHeader(headerLike(0n));
      },
    });

    const state = await sdk.getL1State(client, []);

    expect(findDeposits).toHaveBeenCalledWith(client, {
      onChain: true,
      pageSize: 400,
      tip,
    });
    expect(state.system.ckbAvailable).toBe(ccc.fixedPointFrom(100082));
    expect(state.system.ckbMaturing).toEqual([]);
  });
});
