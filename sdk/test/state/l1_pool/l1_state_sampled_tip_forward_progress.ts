import type { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { defaultL1Sdk, FeeRateStubClient } from "../l1_account/support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IckbSdk.getL1AccountState", () => {
  it("uses the sampled L1 tip when scanning crosses forward tip progress", async () => {
    const firstTip = headerLike(1n, { timestamp: BigInt(Date.now()), nonce: 0x01n });
    const secondTip = headerLike(2n, { timestamp: BigInt(Date.now()), nonce: 0x02n });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const sdk = defaultL1Sdk();
    const client = new FeeRateStubClient({
      getTipHeader,
      cells: (): ccc.Cell[] => [],
    });

    const state = await sdk.getL1AccountState(client, [], WALLET_LOCK_UP);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });
});
