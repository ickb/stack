import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("passes custom pool deposit scan options through L1 state loading", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockResolvedValue([]);
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      findCellsOnChain: emptyCellScan,
    });
    const minLockUp = ccc.Epoch.from([0n, 1n, 16n]);
    const maxLockUp = ccc.Epoch.from([0n, 4n, 16n]);

    await sdk.getL1AccountState(client, [], { poolDeposits: { minLockUp, maxLockUp } });

    expect(findDeposits.mock.calls[0]?.[1]).toBe(baseTip);
    expect(findDeposits.mock.calls[0]?.[2]).toEqual({ minLockUp, maxLockUp });
  });
});
