import type { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  defaultL1Sdk,
  emptyCellScan,
  FeeRateStubClient,
  L1_STATE_SUITE,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("uses the sampled L1 tip when account state scanning crosses forward tip progress", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { hash: hash("01") });
    const secondTip = headerLike(2n, { hash: hash("02") });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const client = new FeeRateStubClient({
      getTipHeader,
      findCellsOnChain: emptyCellScan,
    });

    const state = await defaultL1Sdk().getL1AccountState(client, [accountLock]);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });

  it("does not refetch the tip to detect reorgs during account state scanning", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { hash: hash("01") });
    const secondTip = headerLike(2n, { hash: hash("02") });
    const replacedFirstTip = headerLike(1n, { hash: hash("03") });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const getHeaderByNumber: ccc.Client["getHeaderByNumber"] = vi
      .fn<ccc.Client["getHeaderByNumber"]>()
      .mockResolvedValue(replacedFirstTip);
    const client = new FeeRateStubClient({
      getTipHeader,
      getHeaderByNumber,
      findCellsOnChain: emptyCellScan,
    });

    const state = await defaultL1Sdk().getL1AccountState(client, [accountLock]);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
    expect(getHeaderByNumber).not.toHaveBeenCalled();
  });

  it("does not refetch the tip when the chain tip is replaced during account state scanning", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { hash: hash("01") });
    const replacementTip = headerLike(1n, { hash: hash("02") });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(replacementTip);
    const client = new FeeRateStubClient({
      getTipHeader,
      findCellsOnChain: emptyCellScan,
    });

    const state = await defaultL1Sdk().getL1AccountState(client, [accountLock]);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });
});
