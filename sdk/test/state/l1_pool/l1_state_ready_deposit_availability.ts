import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAO } from "../../../src/constants.ts";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";

import { LogicManager } from "../../../src/logic.ts";
import { depositCell } from "../../conversion/withdrawal_quotes/support/sdk_cell_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  anchoredAt,
  FeeRateStubClient,
  l1SdkWithManagers,
} from "../l1_account/support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getL1AccountState", () => {
  it("carries the pool deposits, judged against the tip, as the CKB supply", async () => {
    const logic = script("22");
    const logicManager = new LogicManager(logic, [], { script: DAO, cellDeps: [] });
    const readyDeposit = depositCell("03", logic, DAO, headerLike(0n), headerLike(0n), {
      isReady: true,
    });
    const findDeposits = vi
      .spyOn(logicManager, "findDeposits")
      .mockResolvedValue([readyDeposit]);
    const sdk = l1SdkWithManagers({ logicManager });
    const tip = headerLike(1n, {
      epoch: ccc.Epoch.from([181n, 0n, 1n]),
      timestamp: BigInt(Date.now()),
    });
    const client = new FeeRateStubClient({
      ...anchoredAt(tip),
      cells: (): ccc.Cell[] => [],
    });

    const state = await sdk.getL1AccountState(client, [], WALLET_LOCK_UP);

    expect(findDeposits.mock.calls[0]?.[1]).toBe(tip);
    expect(state.system.poolDeposits).toEqual([readyDeposit]);
  });
});
