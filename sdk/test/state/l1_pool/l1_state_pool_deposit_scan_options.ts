import { afterEach, describe, expect, it, vi } from "vitest";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { baseTip } from "../../transaction/base/support/sdk_core_support.ts";
import {
  emptyCellScan,
  FeeRateStubClient,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("scans the pool at the tip and carries the caller's timing policy on the state", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockResolvedValue([]);
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsPagedNoCache: emptyCellScan,
    });

    const { system } = await sdk.getL1AccountState(client, [], BOT_LOCK_UP);

    expect(findDeposits).toHaveBeenCalledWith(client, baseTip);
    expect(system.lockUp).toBe(BOT_LOCK_UP);
  });
});
