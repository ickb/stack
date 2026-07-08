import type { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hash, headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  defaultL1Sdk,
  emptyCellScan,
  FeeRateStubClient,
} from "../l1_account/support/sdk_l1_support.ts";
import { L1_STATE_SUITE } from "./support/l1_pool_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("does not refetch the tip to detect reorgs during L1 state scanning", async () => {
    const firstTip = headerLike(1n, { hash: hash("01") });
    const secondTip = headerLike(2n, { hash: hash("02") });
    const replacedFirstTip = headerLike(1n, { hash: hash("03") });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const getHeaderByNumber: ccc.Client["getHeaderByNumber"] = vi
      .fn<ccc.Client["getHeaderByNumber"]>()
      .mockResolvedValue(replacedFirstTip);
    const sdk = defaultL1Sdk();
    const client = new FeeRateStubClient({
      getTipHeader,
      getHeaderByNumber,
      findCellsOnChain: emptyCellScan,
    });

    const state = await sdk.getL1State(client, []);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
    expect(getHeaderByNumber).not.toHaveBeenCalled();
  });

  it("does not refetch the tip when the chain tip is replaced during L1 state scanning", async () => {
    const firstTip = headerLike(1n, { hash: hash("01") });
    const replacementTip = headerLike(1n, { hash: hash("02") });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(replacementTip);
    const sdk = defaultL1Sdk();
    const client = new FeeRateStubClient({
      getTipHeader,
      findCellsOnChain: emptyCellScan,
    });

    const state = await sdk.getL1State(client, []);

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });
});
