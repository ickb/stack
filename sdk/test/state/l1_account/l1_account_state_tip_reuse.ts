import type { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WALLET_LOCK_UP } from "../../../src/dao.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import {
  defaultL1Sdk,
  FeeRateStubClient,
  L1_STATE_SUITE,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("uses the sampled L1 tip when account state scanning crosses forward tip progress", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { timestamp: BigInt(Date.now()), nonce: 0x01n });
    const secondTip = headerLike(2n, { timestamp: BigInt(Date.now()), nonce: 0x02n });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(secondTip);
    const client = new FeeRateStubClient({
      getTipHeader,
      cells: (): ccc.Cell[] => [],
    });

    const state = await defaultL1Sdk().getL1AccountState(
      client,
      [accountLock],
      WALLET_LOCK_UP,
    );

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });

  it("does not refetch the tip to detect reorgs during account state scanning", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { timestamp: BigInt(Date.now()), nonce: 0x01n });
    const secondTip = headerLike(2n, { timestamp: BigInt(Date.now()), nonce: 0x02n });
    const replacedFirstTip = headerLike(1n, {
      timestamp: BigInt(Date.now()),
      nonce: 0x03n,
    });
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
      cells: (): ccc.Cell[] => [],
    });

    const state = await defaultL1Sdk().getL1AccountState(
      client,
      [accountLock],
      WALLET_LOCK_UP,
    );

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
    expect(getHeaderByNumber).not.toHaveBeenCalled();
  });

  it("does not refetch the tip when the chain tip is replaced during account state scanning", async () => {
    const accountLock = script("11");
    const firstTip = headerLike(1n, { timestamp: BigInt(Date.now()), nonce: 0x01n });
    const replacementTip = headerLike(1n, {
      timestamp: BigInt(Date.now()),
      nonce: 0x02n,
    });
    const getTipHeader: ccc.Client["getTipHeader"] = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(firstTip)
      .mockResolvedValueOnce(replacementTip);
    const client = new FeeRateStubClient({
      getTipHeader,
      cells: (): ccc.Cell[] => [],
    });

    const state = await defaultL1Sdk().getL1AccountState(
      client,
      [accountLock],
      WALLET_LOCK_UP,
    );

    expect(state.system.tip).toBe(firstTip);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
  });
});
