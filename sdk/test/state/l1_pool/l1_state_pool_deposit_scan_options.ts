import { afterEach, describe, expect, it, vi } from "vitest";
import { BOT_LOCK_UP } from "../../../src/dao.ts";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  tipHeaderHandler,
} from "../l1_account/support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getL1AccountState", () => {
  it("scans the pool at the tip and carries the caller's timing policy on the state", async () => {
    const { sdk, logicManager } = testSdk();
    const findDeposits = vi.spyOn(logicManager, "findDeposits").mockResolvedValue([]);
    const tip = headerLike(0n, { timestamp: BigInt(Date.now()) });
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(tip),
      cells: (): never[] => [],
    });

    const { system } = await sdk.getL1AccountState(client, [], BOT_LOCK_UP);

    // The scan reads through the SDK's own verified wrapper of the client.
    expect(findDeposits).toHaveBeenCalledWith(expect.anything(), tip);
    expect(system.lockUp).toBe(BOT_LOCK_UP);
  });
});
