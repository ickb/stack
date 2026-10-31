import type { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import { BOT_LOCK_UP, WALLET_LOCK_UP } from "../../../src/dao.ts";
import { headerLike } from "../../transaction/base/support/sdk_core_support.ts";
import { defaultL1Sdk, FeeRateStubClient } from "../l1_account/support/sdk_l1_support.ts";

describe("IckbSdk.getL1AccountState", () => {
  it("reads the tip once and anchors the whole read at its parent", async () => {
    const parent = headerLike(1n, { timestamp: BigInt(Date.now()) });
    const tip = headerLike(2n, {
      parentHash: parent.hash,
      timestamp: BigInt(Date.now()),
    });
    const getTipHeader = vi
      .fn<ccc.Client["getTipHeader"]>()
      .mockResolvedValueOnce(tip)
      .mockResolvedValue(headerLike(3n, { timestamp: BigInt(Date.now()) }));
    const getHeaderByNumber = vi
      .fn<ccc.Client["getHeaderByNumber"]>()
      .mockResolvedValue(parent);
    const client = new FeeRateStubClient({
      getTipHeader,
      getHeaderByNumber,
      cells: (): ccc.Cell[] => [],
    });

    const state = await defaultL1Sdk().getL1AccountState(client, [], WALLET_LOCK_UP);

    expect(state.system.tip).toBe(parent);
    expect(getTipHeader).toHaveBeenCalledTimes(1);
    expect(getHeaderByNumber).toHaveBeenCalledExactlyOnceWith(1n);
  });

  it("refuses a block that is not the tip's parent", async () => {
    const tip = headerLike(2n, { timestamp: BigInt(Date.now()) });
    const client = new FeeRateStubClient({
      getTipHeader: vi.fn<ccc.Client["getTipHeader"]>().mockResolvedValue(tip),
      getHeaderByNumber: vi
        .fn<ccc.Client["getHeaderByNumber"]>()
        .mockResolvedValue(headerLike(1n)),
      cells: (): ccc.Cell[] => [],
    });

    await expect(
      defaultL1Sdk().getL1AccountState(client, [], WALLET_LOCK_UP),
    ).rejects.toThrow(`Block 1 is not the parent of tip ${tip.hash}`);
  });

  it("bounds the age of the parent, not just the tip", async () => {
    // A fresh tip a node invented, naming a real but old block as its parent.
    const parent = headerLike(1n, { timestamp: BigInt(Date.now() - 600_000) });
    const tip = headerLike(2n, {
      parentHash: parent.hash,
      timestamp: BigInt(Date.now()),
    });
    const client = new FeeRateStubClient({
      getTipHeader: vi.fn<ccc.Client["getTipHeader"]>().mockResolvedValue(tip),
      getHeaderByNumber: vi
        .fn<ccc.Client["getHeaderByNumber"]>()
        .mockResolvedValue(parent),
      cells: (): ccc.Cell[] => [],
    });

    await expect(
      defaultL1Sdk().getL1AccountState(client, [], BOT_LOCK_UP),
    ).rejects.toThrow(`Block ${parent.hash} is more than 300000 ms old`);
  });
});
