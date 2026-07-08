import { ccc } from "@ckb-ccc/core";
import { script, StubClient } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testSdk } from "../../conversion/deposits_and_limits/support/sdk_fixture_support.ts";
import {
  baseTip,
  hash,
  headerLike,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  FeeRateStubClient,
  L1_STATE_SUITE,
  none,
  repeat,
  tipHeaderHandler,
} from "./support/sdk_l1_support.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe(L1_STATE_SUITE, () => {
  it("keeps explicit current-tip assertion available for callers that require it", async () => {
    const { sdk } = testSdk();
    const sampledTip = headerLike(1n, { hash: hash("01") });
    const currentTip = headerLike(2n, { hash: hash("02") });
    const client = new StubClient({
      getTipHeader: vi.fn<ccc.Client["getTipHeader"]>().mockResolvedValue(currentTip),
    });

    await expect(sdk.assertCurrentTip(client, sampledTip)).rejects.toThrow(
      `sampled block ${String(sampledTip.number)} ${sampledTip.hash}; current block ${String(currentTip.number)} ${currentTip.hash}`,
    );
  });

  it("accepts an unchanged sampled tip", async () => {
    const { sdk } = testSdk();
    const sampledTip = headerLike(1n, { hash: hash("01") });
    const client = new StubClient({
      getTipHeader: vi.fn<ccc.Client["getTipHeader"]>().mockResolvedValue(sampledTip),
    });

    await expect(sdk.assertCurrentTip(client, sampledTip)).resolves.toBeUndefined();
  });
});

describe(`${L1_STATE_SUITE} page sizes`, () => {
  it("passes one custom page size through L1 account state loading", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager } = testSdk();
    const accountLock = script("77");
    vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
    const findReceipts = vi
      .spyOn(logicManager, "findReceipts")
      .mockImplementation(() => none());
    const findWithdrawalGroups = vi
      .spyOn(ownedOwnerManager, "findWithdrawalGroups")
      .mockImplementation(() => none());
    vi.spyOn(orderManager, "findOrders").mockImplementation(() => none());
    const cell = ccc.Cell.from({
      outPoint: { txHash: hash("93"), index: 0n },
      cellOutput: { capacity: 5n, lock: accountLock },
      outputData: "0x",
    });
    const cellPageSize = 1;
    let requestedPageSize = 0;
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      async *findCellsOnChain(
        _query,
        _order,
        pageSize,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        requestedPageSize = pageSize ?? 0;
        yield* repeat(2, cell);
        await Promise.resolve();
      },
    });

    const state = await sdk.getL1AccountState(client, [accountLock], {
      cellPageSize,
    });

    expect(requestedPageSize).toBe(cellPageSize);
    expect(findReceipts.mock.calls[0]?.[2]).toMatchObject({
      pageSize: cellPageSize,
    });
    expect(findWithdrawalGroups.mock.calls[0]?.[2]).toMatchObject({
      pageSize: cellPageSize,
    });
    expect(state.account.capacityCells).toEqual([cell, cell]);
  });

  it("uses default page sizes when L1 account state loading has no override", async () => {
    const { sdk, logicManager, ownedOwnerManager, orderManager } = testSdk();
    const accountLock = script("78");
    vi.spyOn(logicManager, "findDeposits").mockImplementation(() => none());
    const findReceipts = vi
      .spyOn(logicManager, "findReceipts")
      .mockImplementation(() => none());
    const findWithdrawalGroups = vi
      .spyOn(ownedOwnerManager, "findWithdrawalGroups")
      .mockImplementation(() => none());
    vi.spyOn(orderManager, "findOrders").mockImplementation(() => none());
    let requestedPageSize = 0;
    const client = new FeeRateStubClient({
      getTipHeader: tipHeaderHandler(baseTip),
      async *findCellsOnChain(
        _query,
        _order,
        pageSize,
      ): ReturnType<ccc.Client["findCellsOnChain"]> {
        requestedPageSize = pageSize ?? 0;
        yield* none<ccc.Cell>();
        await Promise.resolve();
      },
    });

    await sdk.getL1AccountState(client, [accountLock]);

    expect(requestedPageSize).toBeGreaterThan(1);
    expect(findReceipts.mock.calls[0]?.[2]).toMatchObject({
      pageSize: requestedPageSize,
    });
    expect(findWithdrawalGroups.mock.calls[0]?.[2]).toMatchObject({
      pageSize: requestedPageSize,
    });
  });
});
