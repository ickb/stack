import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogicManager } from "../../../src/logic.ts";
import { OwnedOwnerManager } from "../../../src/owned_owner.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  l1SdkWithManagers,
  tipHeaderHandler,
  transactionWithHeader,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("carries the pool deposits, judged against the tip, as the CKB supply", async () => {
    const logic = script("22");
    const dao = script("33");
    const ownedOwner = script("44");
    const daoManager = { script: dao, cellDeps: [] };
    const logicManager = new LogicManager(logic, [], daoManager);
    const ownedOwnerManager = new OwnedOwnerManager(ownedOwner, [], daoManager);
    const readyDeposit = depositCell("03", logic, dao, headerLike(0n), headerLike(0n), {
      isReady: true,
    });
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockResolvedValue([readyDeposit]);
    const sdk = l1SdkWithManagers({
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

    const state = await sdk.getL1AccountState(client, []);

    expect(findDeposits.mock.calls[0]?.[1]).toBe(tip);
    expect(state.system.poolDeposits).toEqual([readyDeposit]);
  });
});
